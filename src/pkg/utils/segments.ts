import sharp, { type Metadata, type Sharp } from "sharp";
import * as fs from "fs";
import * as path from "path";

interface BoundingBox { minRow: number; minCol: number; maxRow: number; maxCol: number }
interface OutputPanel { left: number; top: number; width: number; height: number }
interface DetectResult { panels: number; success: boolean }

function rgbToGrayscale(data: Buffer, width: number, height: number, channels: number): Float32Array {
    const len = width * height;
    const grayscale = new Float32Array(len);
    if (channels === 1) {
        for (let i = 0; i < len; i++) grayscale[i] = data[i]!;
    } else {
        for (let i = 0, j = 0; i < len; i++, j += channels) {
            grayscale[i] = 0.299 * data[j]! + 0.587 * data[j + 1]! + 0.114 * data[j + 2]!;
        }
    }
    return grayscale;
}

function gaussianBlur(image: Float32Array, width: number, height: number, sigma = 1.4): Float32Array {
    const size = Math.ceil(sigma * 6) | 1;
    const kernel = new Float32Array(size);
    const center = size >> 1;
    let sum = 0;
    for (let i = 0; i < size; i++) {
        const d = i - center;
        kernel[i] = Math.exp(-(d * d) / (2 * sigma * sigma));
        sum += kernel[i]!;
    }

    for (let i = 0; i < size; i++) kernel[i]! /= sum;

    const temp = new Float32Array(width * height);
    const result = new Float32Array(width * height);
    const half = center;

    for (let y = 0; y < height; y++) {
        const rowOff = y * width;
        for (let x = 0; x < width; x++) {
            let s = 0;
            for (let k = 0; k < size; k++) {
                const ix = Math.min(Math.max(x + k - half, 0), width - 1);
                s += image[rowOff + ix]! * kernel[k]!;
            }
            temp[rowOff + x] = s;
        }
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let s = 0;
            for (let k = 0; k < size; k++) {
                const iy = Math.min(Math.max(y + k - half, 0), height - 1);
                s += temp[iy * width + x]! * kernel[k]!;
            }
            result[y * width + x] = s;
        }
    }
    return result;
}

function cannyEdgeDetection(grayscale: Float32Array, width: number, height: number): Uint8Array {
    const blurred = gaussianBlur(grayscale, width, height, 1.4);
    const len = width * height;
    const magnitude = new Float32Array(len);
    const direction = new Uint8Array(len); // 0-3 for 4 directions (saves memory)

    // Sobel + magnitude/direction in one pass
    for (let y = 1; y < height - 1; y++) {
        const yOff = y * width;
        const yOffM = (y - 1) * width;
        const yOffP = (y + 1) * width;
        for (let x = 1; x < width - 1; x++) {
            const tl = blurred[yOffM + x - 1]!, tc = blurred[yOffM + x]!, tr = blurred[yOffM + x + 1]!;
            const ml = blurred[yOff + x - 1]!, mr = blurred[yOff + x + 1]!;
            const bl = blurred[yOffP + x - 1]!, bc = blurred[yOffP + x]!, br = blurred[yOffP + x + 1]!;

            const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
            const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
            magnitude[yOff + x] = Math.sqrt(gx * gx + gy * gy);

            const angle = ((Math.atan2(gy, gx) * 180 / Math.PI) + 180) % 180;
            direction[yOff + x] = angle < 22.5 || angle >= 157.5 ? 0 : angle < 67.5 ? 1 : angle < 112.5 ? 2 : 3;
        }
    }

    // Non-maximum suppression
    const suppressed = new Float32Array(len);
    for (let y = 1; y < height - 1; y++) {
        const yOff = y * width;
        for (let x = 1; x < width - 1; x++) {
            const idx = yOff + x;
            const mag = magnitude[idx]!;
            const dir = direction[idx]!;
            let n1: number, n2: number;

            if (dir === 0) { n1 = magnitude[idx - 1]!; n2 = magnitude[idx + 1]!; }
            else if (dir === 1) { n1 = magnitude[idx - width + 1]!; n2 = magnitude[idx + width - 1]!; }
            else if (dir === 2) { n1 = magnitude[idx - width]!; n2 = magnitude[idx + width]!; }
            else { n1 = magnitude[idx - width - 1]!; n2 = magnitude[idx + width + 1]!; }

            suppressed[idx] = mag >= n1 && mag >= n2 ? mag : 0;
        }
    }

    // Find max and apply thresholds
    let max = 0;
    for (let i = 0; i < len; i++) if (suppressed[i]! > max) max = suppressed[i]!;
    const high = max * 0.15, low = max * 0.05;

    const edges = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        edges[i] = suppressed[i]! >= high ? 255 : suppressed[i]! >= low ? 128 : 0;
    }

    // Hysteresis with optimized iteration
    let changed = true;
    while (changed) {
        changed = false;
        for (let y = 1; y < height - 1; y++) {
            const yOff = y * width;
            for (let x = 1; x < width - 1; x++) {
                const idx = yOff + x;
                if (edges[idx] !== 128) continue;

                if (edges[idx - width - 1] === 255 || edges[idx - width] === 255 || edges[idx - width + 1] === 255 ||
                    edges[idx - 1] === 255 || edges[idx + 1] === 255 ||
                    edges[idx + width - 1] === 255 || edges[idx + width] === 255 || edges[idx + width + 1] === 255) {
                    edges[idx] = 255;
                    changed = true;
                }
            }
        }
    }

    for (let i = 0; i < len; i++) if (edges[i] === 128) edges[i] = 0;
    return edges;
}

function dilate(image: Uint8Array, width: number, height: number, iterations = 2): Uint8Array {
    const len = width * height;
    let src: Uint8Array<ArrayBuffer> = new Uint8Array(image);
    let dst: Uint8Array<ArrayBuffer> = new Uint8Array(len);

    for (let iter = 0; iter < iterations; iter++) {
        for (let y = 1; y < height - 1; y++) {
            const yOff = y * width;
            for (let x = 1; x < width - 1; x++) {
                const idx = yOff + x;
                dst[idx] = Math.max(
                    src[idx - width - 1]!, src[idx - width]!, src[idx - width + 1]!,
                    src[idx - 1]!, src[idx]!, src[idx + 1]!,
                    src[idx + width - 1]!, src[idx + width]!, src[idx + width + 1]!
                );
            }
        }
        if (iter < iterations - 1) [src, dst] = [dst, src];
    }
    return dst;
}

function binaryFillHoles(edges: Uint8Array, width: number, height: number): Uint8Array {
    const len = width * height;
    const result = new Uint8Array(len).fill(255);
    const visited = new Uint8Array(len);
    const stack = new Int32Array(len); // Pre-allocated stack
    let stackPtr = 0;

    // Seed borders
    for (let x = 0; x < width; x++) {
        if (edges[x] === 0) stack[stackPtr++] = x;
        const bot = (height - 1) * width + x;
        if (edges[bot] === 0) stack[stackPtr++] = bot;
    }
    for (let y = 1; y < height - 1; y++) {
        const left = y * width, right = left + width - 1;
        if (edges[left] === 0) stack[stackPtr++] = left;
        if (edges[right] === 0) stack[stackPtr++] = right;
    }

    while (stackPtr > 0) {
        const idx = stack[--stackPtr]!;
        if (visited[idx]) continue;
        visited[idx] = 1;
        if (edges[idx] !== 0) continue;

        result[idx] = 0;
        const x = idx % width, y = (idx / width) | 0;
        if (x > 0 && !visited[idx - 1]) stack[stackPtr++] = idx - 1;
        if (x < width - 1 && !visited[idx + 1]) stack[stackPtr++] = idx + 1;
        if (y > 0 && !visited[idx - width]) stack[stackPtr++] = idx - width;
        if (y < height - 1 && !visited[idx + width]) stack[stackPtr++] = idx + width;
    }
    return result;
}

function labelComponentsWithBoxes(binary: Uint8Array, width: number, height: number): BoundingBox[] {
    const len = width * height;
    const labels = new Int32Array(len);
    const boxes: BoundingBox[] = [];
    const stack = new Int32Array(len);
    let stackPtr = 0;

    for (let y = 0; y < height; y++) {
        const yOff = y * width;
        for (let x = 0; x < width; x++) {
            const idx = yOff + x;
            if (binary[idx] !== 255 || labels[idx] !== 0) continue;

            const label = boxes.length + 1;
            let minRow = y, maxRow = y, minCol = x, maxCol = x;
            stack[stackPtr++] = idx;

            while (stackPtr > 0) {
                const cur = stack[--stackPtr]!;
                if (labels[cur] !== 0) continue;
                labels[cur] = label;

                const cx = cur % width, cy = (cur / width) | 0;
                minRow = Math.min(minRow, cy); maxRow = Math.max(maxRow, cy);
                minCol = Math.min(minCol, cx); maxCol = Math.max(maxCol, cx);

                if (cx > 0 && binary[cur - 1] === 255 && !labels[cur - 1]) stack[stackPtr++] = cur - 1;
                if (cx < width - 1 && binary[cur + 1] === 255 && !labels[cur + 1]) stack[stackPtr++] = cur + 1;
                if (cy > 0 && binary[cur - width] === 255 && !labels[cur - width]) stack[stackPtr++] = cur - width;
                if (cy < height - 1 && binary[cur + width] === 255 && !labels[cur + width]) stack[stackPtr++] = cur + width;
            }
            boxes.push({ minRow, minCol, maxRow, maxCol });
        }
    }
    return boxes;
}

function mergeOverlapping(regions: BoundingBox[]): BoundingBox[] {
    const panels: BoundingBox[] = [];
    for (const r of regions) {
        let merged = false;
        for (let i = 0; i < panels.length; i++) {
            const p = panels[i]!;
            if (r.minRow < p.maxRow && r.maxRow > p.minRow && r.minCol < p.maxCol && r.maxCol > p.minCol) {
                panels[i] = {
                    minRow: Math.min(r.minRow, p.minRow), minCol: Math.min(r.minCol, p.minCol),
                    maxRow: Math.max(r.maxRow, p.maxRow), maxCol: Math.max(r.maxCol, p.maxCol)
                };
                merged = true;
                break;
            }
        }
        if (!merged) panels.push({ ...r });
    }
    return panels;
}

type NestedPanels = BoundingBox | NestedPanels[];

function clusterPanels(bboxes: BoundingBox[], axis: "row" | "col" = "row", depth = 0): NestedPanels[] {
    if (depth > 10 || bboxes.length <= 1) {
        const key = axis === "row" ? "minRow" : "minCol";
        return [...bboxes].sort((a, b) => a[key] - b[key]);
    }

    const clusters: BoundingBox[][] = [];
    for (const bbox of bboxes) {
        let added = false;
        for (const cluster of clusters) {
            const aligned = cluster.some(b =>
                axis === "row" ? b.minRow < bbox.maxRow && bbox.minRow < b.maxRow
                    : b.minCol < bbox.maxCol && bbox.minCol < b.maxCol
            );
            if (aligned) { cluster.push(bbox); added = true; break; }
        }
        if (!added) clusters.push([bbox]);
    }

    if (clusters.length === 1 && clusters[0]!.length === bboxes.length) {
        const key = axis === "row" ? "minRow" : "minCol";
        return [...bboxes].sort((a, b) => a[key] - b[key]);
    }

    clusters.sort((a, b) => axis === "row" ? a[0]!.minRow - b[0]!.minRow : a[0]!.minCol - b[0]!.minCol);
    return clusters.map(c => c.length > 1 ? clusterPanels(c, axis === "row" ? "col" : "row", depth + 1) : c[0]!);
}

function* flattenPanels(nested: NestedPanels[]): Generator<BoundingBox> {
    for (const item of nested) {
        if (Array.isArray(item)) yield* flattenPanels(item);
        else yield item;
    }
}

function generateOverlaySvg(panels: OutputPanel[], width: number, height: number): Buffer {
    const rects = panels.map((p, i) => {
        const c = Math.min(20, p.width / 6, p.height / 6);
        const r = p.left + p.width, b = p.top + p.height;
        return `<rect x="${p.left}" y="${p.top}" width="${p.width}" height="${p.height}" fill="none" stroke="#ff3366" stroke-width="3"/>
<path d="M${p.left},${p.top + c}L${p.left},${p.top}L${p.left + c},${p.top}" fill="none" stroke="#ffdd00" stroke-width="5"/>
<path d="M${r - c},${p.top}L${r},${p.top}L${r},${p.top + c}" fill="none" stroke="#ffdd00" stroke-width="5"/>
<path d="M${p.left},${b - c}L${p.left},${b}L${p.left + c},${b}" fill="none" stroke="#ffdd00" stroke-width="5"/>
<path d="M${r - c},${b}L${r},${b}L${r},${b - c}" fill="none" stroke="#ffdd00" stroke-width="5"/>
<rect x="${p.left + 8}" y="${b - 62}" width="${130 + (i >= 9 ? 12 : 0)}" height="54" rx="4" fill="rgba(0,0,0,0.85)" stroke="#ff3366" stroke-width="2"/>
<text x="${p.left + 16}" y="${b - 17}" font-family="Arial,sans-serif" font-size="32" font-weight="bold" fill="white">Panel ${i + 1}</text>`;
    }).join('\n');

    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects}</svg>`);
}

export async function DetectAndExtractPanels(imagePath: string, deleteOriginal = false): Promise<DetectResult> {
    const fullPath = path.resolve(imagePath);
    const dir = path.dirname(fullPath);
    const name = path.basename(fullPath, path.extname(fullPath));
    const ext = path.extname(fullPath);

    try {
        const imageBuffer = fs.readFileSync(fullPath);
        const image: Sharp = sharp(imageBuffer);
        const metadata: Metadata = await image.metadata();

        if (!metadata.width || !metadata.height) throw new Error('Could not read image dimensions');

        const processingWidth = Math.min(1500, metadata.width);
        const scale = metadata.width / processingWidth;

        const { data: buffer, info } = await image.clone().resize(processingWidth).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const { width, height, channels } = info;

        const grayscale = rgbToGrayscale(buffer, width, height, channels);
        const edges = cannyEdgeDetection(grayscale, width, height);
        const dilated = dilate(edges, width, height, 2);
        const filled = binaryFillHoles(dilated, width, height);
        const regions = labelComponentsWithBoxes(filled, width, height);
        const merged = mergeOverlapping(regions);

        const imageArea = width * height;
        const filtered = merged.filter(b => (b.maxRow - b.minRow) * (b.maxCol - b.minCol) >= 0.01 * imageArea);
        const clustered = clusterPanels(filtered);
        const ordered = [...flattenPanels(clustered)];

        const outputPanels: OutputPanel[] = ordered.map(p => ({
            left: Math.floor(p.minCol * scale),
            top: Math.floor(p.minRow * scale),
            width: Math.ceil((p.maxCol - p.minCol) * scale),
            height: Math.ceil((p.maxRow - p.minRow) * scale)
        }));

        if (outputPanels.length === 0) return { panels: 0, success: true };

        const panelsDir = path.join(dir, name);
        if (!fs.existsSync(panelsDir)) fs.mkdirSync(panelsDir, { recursive: true });

        const extractPromises = outputPanels.map(async (p, i) => {
            const region = {
                left: Math.max(0, p.left),
                top: Math.max(0, p.top),
                width: Math.min(metadata.width! - p.left, p.width),
                height: Math.min(metadata.height! - p.top, p.height)
            };
            if (region.width > 0 && region.height > 0) {
                await sharp(imageBuffer).extract(region).toFile(path.join(panelsDir, `${i + 1}${ext}`));
            }
        });
        await Promise.all(extractPromises);

        const overlaySvg = generateOverlaySvg(outputPanels, metadata.width, metadata.height);
        await sharp(imageBuffer).composite([{ input: overlaySvg, top: 0, left: 0 }]).toFile(path.join(dir, `${name}.png`));

        if (deleteOriginal) fs.unlinkSync(fullPath);
        return { panels: outputPanels.length, success: true };
    } catch (err) {
        console.error(`  Error: ${(err as Error).message}`);
        return { panels: 0, success: false };
    }
}