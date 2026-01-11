import { createExtractorFromFile } from 'node-unrar-js';
import AdmZip from 'adm-zip';
import Seven from 'node-7z';
import sevenBin from '7zip-bin';
import * as tar from 'tar';
import sharp, { type Metadata, type Sharp } from 'sharp';
import fs from 'fs';
import path from 'path';

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

        const width = info.width;
        const height = info.height;

        const visited = new Uint8Array(width * height);
        const panels: Panel[] = [];
        const idx = (x: number, y: number): number => y * width + x;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = idx(x, y);
                if (buffer[i] === 0 && visited[i] === 0) {
                    const panel: Panel = { minX: x, maxX: x, minY: y, maxY: y, pixelCount: 0 };
                    const queue: number[] = [x, y];
                    visited[i] = 1;

                    while (queue.length > 0) {
                        const cy = queue.pop()!;
                        const cx = queue.pop()!;

                        panel.pixelCount++;
                        if (cx < panel.minX) panel.minX = cx;
                        if (cx > panel.maxX) panel.maxX = cx;
                        if (cy < panel.minY) panel.minY = cy;
                        if (cy > panel.maxY) panel.maxY = cy;

                        const neighbors: [number, number][] = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
                        for (const [nx, ny] of neighbors) {
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
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
                return (w > 50 && h > 50 && p.pixelCount > 1000);
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

// Extract CBR (RAR archive)
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

    yield { event: 'update', data: { message: `Extracting contents from book` } };

    try {
        let extractedCount: number;

        switch (format) {
            case 'cbr':
                extractedCount = await extractCBR(fullPath, outputDir);
                break;
            case 'cbz':
                extractedCount = await extractCBZ(fullPath, outputDir);
                break;
            case 'cb7':
                extractedCount = await extractCB7(fullPath, outputDir);
                break;
            case 'cbt':
                extractedCount = await extractCBT(fullPath, outputDir);
                break;
            default:
                throw new Error(`Unsupported format: ${format}`);
        }

        yield { event: 'update', data: { message: `Extracted ${extractedCount} files. Preparing for panel detection...` } };

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

    yield { event: 'update', data: { message: 'Starting smart panel detection and cropping...' } };
    for (let i = 0; i < imageFiles.length; i++) {
        const imagePath = imageFiles[i]!;
        const imageFile = path.basename(imagePath);

        yield { event: 'update', data: { message: `Processing page ${i + 1} of ${imageFiles.length}...`, } };

        await detectAndCropPanels(imagePath, true);
    }

    yield { event: 'update', data: { message: 'Process complete. All panels have been extracted.', format } };
}

export default SliceComic;
export { getComicFormat, supportedFormats, type ComicFormat };