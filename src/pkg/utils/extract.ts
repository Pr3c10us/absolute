import { createExtractorFromFile } from 'node-unrar-js';
import AdmZip from 'adm-zip';
import Seven from 'node-7z';
import sevenBin from '7zip-bin';
import * as tar from 'tar';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { DetectAndExtractPanels } from "./segments.ts";
import * as pdfPoppler from 'pdf-poppler';

export interface ExtractEvent {
    event: string;
    data: any;
}

type ComicFormat = 'cbr' | 'cbz' | 'cb7' | 'cbt' | 'pdf';

const imageExtensions: string[] = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'];

const supportedFormats: Record<ComicFormat, string> = {
    cbr: '.cbr',
    cbz: '.cbz',
    cb7: '.cb7',
    cbt: '.cbt',
    pdf: '.pdf',
};

function getComicFormat(filePath: string): ComicFormat | null {
    const ext = path.extname(filePath).toLowerCase();
    for (const [format, extension] of Object.entries(supportedFormats)) {
        if (ext === extension) return format as ComicFormat;
    }
    return null;
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

async function extract(filePath: string, outputDir: string): Promise<number> {
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

async function extractPDF(filePath: string, outputDir: string): Promise<number> {
    const opts: pdfPoppler.Options = {
        format: 'jpeg',
        out_dir: outputDir,
        out_prefix: 'page',
        page: null // convert all pages
    };

    await pdfPoppler.convert(filePath, opts);

    // Count extracted files
    const files = fs.readdirSync(outputDir);
    return files.filter(f => f.startsWith('page') && f.endsWith('.jpg')).length;
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
                await extract(fullPath, outputDir);
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
            case 'pdf':
                await extractPDF(fullPath, outputDir);
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

    if (imageFiles.length > 0) {
        yield { event: 'update', data: { message: 'creating video background' } };
        const firstImagePath = imageFiles[0]!;
        const coverBlurPath = path.join(outputDir, 'cover_blur.jpg');
        await sharp(firstImagePath)
            .blur(20)
            .jpeg({ quality: 80 })
            .toFile(coverBlurPath);
    }

    const extractPanelPromises = imageFiles.map((imagePath) =>
        DetectAndExtractPanels(imagePath, true)
    );
    yield { event: 'update', data: { message: `detecting and extracting panels from pages` } };
    await Promise.all(extractPanelPromises);

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