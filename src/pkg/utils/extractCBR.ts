import { createExtractorFromFile } from 'node-unrar-js';
import AdmZip from 'adm-zip';
import Seven from 'node-7z';
import sevenBin from '7zip-bin';
import * as tar from 'tar';
import sharp, { type Metadata, type Sharp } from 'sharp';
import fs from 'fs';
import path from 'path';
import { DetectAndExtractPanels } from "./segments.ts";

interface Panel {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    pixelCount: number;
}

interface OutputPanel {
    left: number;
    top: number;
    width: number;
    height: number;
}

interface DetectResult {
    panels: number;
    success: boolean;
}

export interface ExtractEvent {
    event: string;
    data: any;
}

type ComicFormat = 'cbr' | 'cbz' | 'cb7' | 'cbt';

const imageExtensions: string[] = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'];

const supportedFormats: Record<ComicFormat, string> = {
    cbr: '.cbr',
    cbz: '.cbz',
    cb7: '.cb7',
    cbt: '.cbt',
};

function getComicFormat(filePath: string): ComicFormat | null {
    const ext = path.extname(filePath).toLowerCase();
    for (const [format, extension] of Object.entries(supportedFormats)) {
        if (ext === extension) return format as ComicFormat;
    }
    return null;
}

function generateOverlaySvg(panels: OutputPanel[], imageWidth: number, imageHeight: number): Buffer {
    const colors: string[] = ['#C41E3A', '#1E3A8A', '#7C3AED', '#047857', '#B45309', '#BE185D', '#0E7490', '#4338CA', '#9D174D', '#065F46'];

    let svgContent = `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">`;

    panels.slice().reverse().forEach((panel, index) => {
        const originalIndex = panels.length - 1 - index;
        const color = colors[originalIndex % colors.length];
        const labelNum = originalIndex + 1;
        const strokeWidth = 4;

        svgContent += `
      <rect x="${panel.left}" y="${panel.top}" width="${panel.width}" height="${panel.height}" 
        fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>`;

        const labelX = panel.left;
        const labelY = panel.top + panel.height - 32;

        svgContent += `
      <rect x="${labelX}" y="${labelY}" width="160" height="32" fill="${color}" rx="5" ry="5"/>
      <text x="${labelX + 80}" y="${labelY + 26}" font-family="Arial" font-size="32" font-weight="bold" 
        fill="white" text-anchor="middle">PANEL ${labelNum}</text>`;
    });

    svgContent += '</svg>';
    return Buffer.from(svgContent);
}

async function addPageNumberToOverlay(imagePath: string, pageNumber: number): Promise<void> {
    const imageBuffer = fs.readFileSync(imagePath);
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
        throw new Error('Could not read image dimensions');
    }

    // Sample the bottom-right corner to determine background brightness (where the number will go)
    const sampleSize = Math.min(100, Math.floor(Math.min(metadata.width, metadata.height) / 4));
    const sampleX = Math.max(0, metadata.width - sampleSize - 10);
    const sampleY = Math.max(0, metadata.height - sampleSize - 10);
    const { data: sampleData } = await image
        .clone()
        .extract({ left: sampleX, top: sampleY, width: sampleSize, height: sampleSize })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

    // Calculate average brightness (0-255)
    let totalBrightness = 0;
    for (let i = 0; i < sampleData.length; i++) {
        totalBrightness += sampleData[i]!;
    }
    const avgBrightness = totalBrightness / sampleData.length;

    // Choose contrasting colors based on background brightness
    const isLightBackground = avgBrightness > 128;
    const textColor = isLightBackground ? '#000000' : '#FFFFFF';
    const bgColor = isLightBackground ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)';
    const strokeColor = isLightBackground ? '#FFFFFF' : '#000000';

    // Calculate font size based on image dimensions (proportional sizing)
    const fontSize = Math.max(48, Math.floor(Math.min(metadata.width, metadata.height) / 12));
    const padding = Math.floor(fontSize * 0.15);
    const labelWidth = fontSize * 1.2;
    const labelHeight = fontSize * 1.1;
    const cornerOffset = Math.floor(fontSize * 0.3);

    // Position at bottom-right
    const labelX = metadata.width - labelWidth - cornerOffset;
    const labelY = metadata.height - labelHeight - cornerOffset;

    // Create SVG overlay with bold page number
    const svgContent = `
        <svg width="${metadata.width}" height="${metadata.height}" xmlns="http://www.w3.org/2000/svg">
            <rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}" 
                fill="${bgColor}" rx="${padding}" ry="${padding}" 
                stroke="${strokeColor}" stroke-width="2"/>
            <text x="${labelX + labelWidth / 2}" y="${labelY + labelHeight * 0.78}" 
                font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="bold" 
                fill="${textColor}" text-anchor="middle">${pageNumber}</text>
        </svg>
    `;

    const overlaySvg = Buffer.from(svgContent);

    // Create a temp path for the new image
    const tempPath = imagePath + '.tmp';

    // Save numbered image to temp path, then replace original
    await sharp(imageBuffer)
        .composite([{ input: overlaySvg, top: 0, left: 0 }])
        .toFile(tempPath);

    // Replace original with temp
    fs.unlinkSync(imagePath);
    fs.renameSync(tempPath, imagePath);
}

async function detectAndCropPanels(imagePath: string, deleteOriginal: boolean = false): Promise<DetectResult> {
    const fullPath = path.resolve(imagePath);
    const dir = path.dirname(fullPath);
    const name = path.basename(fullPath, path.extname(fullPath));
    const ext = path.extname(fullPath);

    try {
        const imageBuffer = fs.readFileSync(fullPath);
        const image: Sharp = sharp(imageBuffer);
        const metadata: Metadata = await image.metadata();

        if (!metadata.width || !metadata.height) {
            throw new Error('Could not read image dimensions');
        }

        const processingWidth = 1000;
        const scale = metadata.width / processingWidth;

        const { data: buffer, info } = await image
            .clone()
            .resize(processingWidth)
            .grayscale()
            .threshold(240)
            .raw()
            .toBuffer({ resolveWithObject: true });

        const visited = new Uint8Array(info.width * info.height);
        const panels: Panel[] = [];

        // function to assign a unique id to each pixel
        const idx = (x: number, y: number): number => y * info.width + x;

        // loop over vertical pixels
        for (let y = 0; y < info.height; y++) {
            // loop over each horizontal pixels
            for (let x = 0; x < info.width; x++) {
                // get pixel id
                const i = idx(x, y);
                // check if pixel is black and unvisited
                if (buffer[i] === 0 && visited[i] === 0) {
                    // panel starts at the pixel
                    const panel: Panel = { minX: x, maxX: x, minY: y, maxY: y, pixelCount: 0 };
                    // create queue for bfs operation
                    const queue: number[] = [x, y];
                    // mark pixel as visited
                    visited[i] = 1;

                    while (queue.length > 0) {
                        // get current pixel pixel axis
                        const cy = queue.pop()!;
                        const cx = queue.pop()!;

                        // increment pixel size
                        panel.pixelCount++;
                        // update panel boundary if new pixel x position is less than current minX, or greater than maxX
                        if (cx < panel.minX) panel.minX = cx;
                        if (cx > panel.maxX) panel.maxX = cx;
                        // update panel boundary if new pixel y position is less than current minY, or greater than maxY
                        if (cy < panel.minY) panel.minY = cy;
                        if (cy > panel.maxY) panel.maxY = cy;

                        // get pixel neighbours and loop over them
                        const neighbors: [number, number][] = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
                        for (const [nx, ny] of neighbors) {
                            // if pixel is not out of image bound, unvisited and black
                            // add pixel to the queue and mark as visited
                            if (nx >= 0 && nx < info.width && ny >= 0 && ny < info.height) {
                                const ni = idx(nx, ny);
                                if (buffer[ni] === 0 && visited[ni] === 0) {
                                    visited[ni] = 1;
                                    queue.push(nx, ny);
                                }
                            }
                        }
                    }
                    panels.push(panel);
                }
            }
        }

        const outputPanels: OutputPanel[] = panels
            .filter(p => {
                const w = p.maxX - p.minX;
                const h = p.maxY - p.minY;
                return (w > 250 && h > 250 && p.pixelCount > 2000);
            })
            .map(p => ({
                left: Math.floor(p.minX * scale),
                top: Math.floor(p.minY * scale),
                width: Math.ceil((p.maxX - p.minX) * scale),
                height: Math.ceil((p.maxY - p.minY) * scale)
            }));

        outputPanels.sort((a, b) => (a.top - b.top) || (a.left - b.left));

        const panelsDir = path.join(dir, name);
        if (!fs.existsSync(panelsDir)) {
            fs.mkdirSync(panelsDir, { recursive: true });
        }

        let count = 1;
        for (const p of outputPanels) {
            const extractRegion = {
                left: Math.max(0, p.left),
                top: Math.max(0, p.top),
                width: Math.min(metadata.width - p.left, p.width),
                height: Math.min(metadata.height - p.top, p.height)
            };

            if (extractRegion.width <= 0 || extractRegion.height <= 0) continue;

            const outputPath = path.join(panelsDir, `${count}${ext}`);
            await sharp(imageBuffer).extract(extractRegion).toFile(outputPath);
            count++;
        }

        const overlaySvg = generateOverlaySvg(outputPanels, metadata.width, metadata.height);
        const enhancedPath = path.join(dir, `${name}.png`);

        await sharp(imageBuffer)
            .composite([{ input: overlaySvg, top: 0, left: 0 }])
            .toFile(enhancedPath);

        if (deleteOriginal) {
            fs.unlinkSync(fullPath);
        }

        return { panels: outputPanels.length, success: true };
    } catch (err) {
        const error = err as Error;
        console.error(`  Error: ${error.message}`);
        return { panels: 0, success: false };
    }
}

async function extractCBR(filePath: string, outputDir: string): Promise<number> {
    const extractor = await createExtractorFromFile({
        filepath: filePath,
        targetPath: outputDir,
    });

    const { files } = extractor.extract();
    let count = 0;
    for (const file of files) {
        if (!file.fileHeader.flags.directory) count++;
    }
    return count;
}

// Extract CBZ (ZIP archive)
async function extractCBZ(filePath: string, outputDir: string): Promise<number> {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    let count = 0;

    for (const entry of entries) {
        if (!entry.isDirectory) {
            const targetPath = path.join(outputDir, entry.entryName);
            const targetDir = path.dirname(targetPath);

            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            fs.writeFileSync(targetPath, entry.getData());
            count++;
        }
    }
    return count;
}

// Extract CB7 (7-Zip archive)
async function extractCB7(filePath: string, outputDir: string): Promise<number> {
    return new Promise((resolve, reject) => {
        let count = 0;
        const stream = Seven.extractFull(filePath, outputDir, {
            $bin: sevenBin.path7za,
            recursive: true,
        });

        stream.on('data', () => count++);
        stream.on('end', () => resolve(count));
        stream.on('error', (err: any) => reject(err));
    });
}

// Extract CBT (TAR archive)
async function extractCBT(filePath: string, outputDir: string): Promise<number> {
    await tar.extract({
        file: filePath,
        cwd: outputDir,
    });

    // Count extracted files
    let count = 0;
    const countFiles = (dir: string) => {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const itemPath = path.join(dir, item);
            if (fs.statSync(itemPath).isDirectory()) {
                countFiles(itemPath);
            } else {
                count++;
            }
        }
    };
    countFiles(outputDir);
    return count;
}

async function* SliceComic(
    comicFile: string,
    dir?: string,
): AsyncGenerator<ExtractEvent> {
    const fullPath = path.resolve(comicFile);

    if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${fullPath}`);
    }

    const format = getComicFormat(fullPath);
    if (!format) {
        const supported = Object.values(supportedFormats).join(', ');
        throw new Error(`Unsupported format. Supported formats: ${supported}`);
    }

    const folderName = path.basename(fullPath, path.extname(fullPath));
    const outputDir = dir
        ? path.resolve(dir)
        : path.join(path.dirname(fullPath), folderName);

    if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    try {
        yield { event: 'update', data: { message: `extracting images` } };

        switch (format) {
            case 'cbr':
                 await extractCBR(fullPath, outputDir);
                break;
            case 'cbz':
                 await extractCBZ(fullPath, outputDir);
                break;
            case 'cb7':
                 await extractCB7(fullPath, outputDir);
                break;
            case 'cbt':
                 await extractCBT(fullPath, outputDir);
                break;
            default:
                throw new Error(`Unsupported format: ${format}`);
        }


    } catch (error) {
        const err = error as Error;
        throw new Error(`Error extracting ${format.toUpperCase()} file: ${err.message}`);
    }

    // Recursively find all image files
    const findImages = (dir: string): string[] => {
        const results: string[] = [];
        const items = fs.readdirSync(dir);

        for (const item of items) {
            const itemPath = path.join(dir, item);
            const stat = fs.statSync(itemPath);

            if (stat.isDirectory()) {
                results.push(...findImages(itemPath));
            } else {
                const ext = path.extname(item).toLowerCase();
                if (imageExtensions.includes(ext)) {
                    results.push(itemPath);
                }
            }
        }
        return results;
    };

    const imageFiles = findImages(outputDir).sort();

    // Create blurred cover image from the first page
    if (imageFiles.length > 0) {
        yield { event: 'update', data: { message: 'creating video background' } };
        const firstImagePath = imageFiles[0]!;
        const coverBlurPath = path.join(outputDir, 'cover_blur.jpg');
        await sharp(firstImagePath)
            .blur(20)
            .jpeg({ quality: 80 })
            .toFile(coverBlurPath);
    }

    // First, detect and extract panels from all images (deletes originals, creates overlay .png files)
    const extractPanelPromises = imageFiles.map((imagePath) =>
        // DetectAndExtractPanels(imagePath, true)
        detectAndCropPanels(imagePath, true)
    );
    yield { event: 'update', data: { message: `detecting and extracting panels from pages` } };
    await Promise.all(extractPanelPromises);

    // Now add page numbers to the overlay images (the .png files created by panel detection)
    // This is done AFTER detection to prevent numbers from being detected as panels
    const overlayImages = imageFiles.map((imagePath) => {
        const dir = path.dirname(imagePath);
        const name = path.basename(imagePath, path.extname(imagePath));
        return path.join(dir, `${name}.png`);
    }).filter(overlayPath => fs.existsSync(overlayPath));

    const numberingPromises = overlayImages.map((overlayPath, i) =>
        addPageNumberToOverlay(overlayPath, i + 1)
    );
    yield { event: 'update', data: { message: `numbering all images` } };
    await Promise.all(numberingPromises);
}

export default SliceComic;
export { getComicFormat, supportedFormats, type ComicFormat };