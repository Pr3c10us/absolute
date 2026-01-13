import sharp, { type Metadata, type Sharp } from "sharp";
import * as fs from "fs";
import * as path from "path";

interface BoundingBox {
    minRow: number;
    minCol: number;
    maxRow: number;
    maxCol: number;
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

function rgbToGrayscale(data: Buffer, width: number, height: number, channels: number): Float32Array {
    const grayscale = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        if (channels === 1) {
            grayscale[i] = data[i]!;
        } else {
            grayscale[i] = 0.299 * data[i * channels]! + 0.587 * data[i * channels + 1]! + 0.114 * data[i * channels + 2]!;
        }
    }
    return grayscale;
}

function gaussianBlur(image: Float32Array, width: number, height: number, sigma = 1.4): Float32Array {
    const size = Math.ceil(sigma * 6) | 1;
    const kernel = new Float32Array(size * size);
    const center = Math.floor(size / 2);
    let sum = 0;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x - center, dy = y - center;
            kernel[y * size + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
            sum += kernel[y * size + x]!;
        }
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] = kernel[i]! / sum;

    const result = new Float32Array(width * height);
    const halfK = Math.floor(size / 2);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let s = 0;
            for (let ky = 0; ky < size; ky++) {
                for (let kx = 0; kx < size; kx++) {
                    const iy = Math.min(Math.max(y + ky - halfK, 0), height - 1);
                    const ix = Math.min(Math.max(x + kx - halfK, 0), width - 1);
                    s += image[iy * width + ix]! * kernel[ky * size + kx]!;
                }
            }
            result[y * width + x] = s;
        }
    }
    return result;
}

function cannyEdgeDetection(grayscale: Float32Array, width: number, height: number): Uint8Array {
    const blurred = gaussianBlur(grayscale, width, height, 1.4);

    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    const magnitude = new Float32Array(width * height);
    const direction = new Float32Array(width * height);

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let gx = 0, gy = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const pixel = blurred[(y + ky) * width + (x + kx)]!;
                    const ki = (ky + 1) * 3 + (kx + 1);
                    gx += pixel * sobelX[ki]!;
                    gy += pixel * sobelY[ki]!;
                }
            }
            magnitude[y * width + x] = Math.sqrt(gx * gx + gy * gy);
            direction[y * width + x] = Math.atan2(gy, gx);
        }
    }

    const suppressed = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const angle = ((direction[idx]! * 180) / Math.PI + 180) % 180;
            const mag = magnitude[idx]!;
            let n1 = 0, n2 = 0;

            if (angle < 22.5 || angle >= 157.5) {
                n1 = magnitude[idx - 1]!; n2 = magnitude[idx + 1]!;
            } else if (angle < 67.5) {
                n1 = magnitude[(y - 1) * width + x + 1]!; n2 = magnitude[(y + 1) * width + x - 1]!;
            } else if (angle < 112.5) {
                n1 = magnitude[(y - 1) * width + x]!; n2 = magnitude[(y + 1) * width + x]!;
            } else {
                n1 = magnitude[(y - 1) * width + x - 1]!; n2 = magnitude[(y + 1) * width + x + 1]!;
            }

            suppressed[idx] = mag >= n1 && mag >= n2 ? mag : 0;
        }
    }

    let max = 0;
    for (let i = 0; i < suppressed.length; i++) {
        if (suppressed[i]! > max) max = suppressed[i]!;
    }
    const high = max * 0.15, low = max * 0.05;
    const edges = new Uint8Array(width * height);
    for (let i = 0; i < suppressed.length; i++) {
        edges[i] = suppressed[i]! >= high ? 255 : suppressed[i]! >= low ? 128 : 0;
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                if (edges[idx] === 128) {
                    outer: for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (edges[(y + dy) * width + (x + dx)] === 255) {
                                edges[idx] = 255;
                                changed = true;
                                break outer;
                            }
                        }
                    }
                }
            }
        }
    }

    for (let i = 0; i < edges.length; i++) {
        if (edges[i] === 128) edges[i] = 0;
    }

    return edges;
}

function dilate(image: Uint8Array, width: number, height: number, iterations = 2): Uint8Array {
    let result = new Uint8Array(image);

    for (let iter = 0; iter < iterations; iter++) {
        const temp = new Uint8Array(result);
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let maxVal = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        maxVal = Math.max(maxVal, result[(y + dy) * width + (x + dx)]!);
                    }
                }
                temp[y * width + x] = maxVal;
            }
        }
        result = temp;
    }

    return result;
}

function binaryFillHoles(edges: Uint8Array, width: number, height: number): Uint8Array {
    const result = new Uint8Array(width * height).fill(255);
    const visited = new Uint8Array(width * height);
    const stack: number[] = [];

    for (let x = 0; x < width; x++) {
        if (edges[x] === 0) stack.push(x);
        if (edges[(height - 1) * width + x] === 0) stack.push((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
        if (edges[y * width] === 0) stack.push(y * width);
        if (edges[y * width + width - 1] === 0) stack.push(y * width + width - 1);
    }

    while (stack.length > 0) {
        const idx = stack.pop()!;
        if (visited[idx]) continue;
        visited[idx] = 1;

        if (edges[idx] === 0) {
            result[idx] = 0;
            const x = idx % width, y = Math.floor(idx / width);
            if (x > 0 && !visited[idx - 1]) stack.push(idx - 1);
            if (x < width - 1 && !visited[idx + 1]) stack.push(idx + 1);
            if (y > 0 && !visited[idx - width]) stack.push(idx - width);
            if (y < height - 1 && !visited[idx + width]) stack.push(idx + width);
        }
    }

    return result;
}

function labelComponents(binary: Uint8Array, width: number, height: number): { labels: Int32Array; numLabels: number } {
    const labels = new Int32Array(width * height);
    let currentLabel = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (binary[idx] === 255 && labels[idx] === 0) {
                currentLabel++;
                const stack = [idx];

                while (stack.length > 0) {
                    const current = stack.pop()!;
                    if (labels[current] !== 0) continue;
                    labels[current] = currentLabel;

                    const cx = current % width, cy = Math.floor(current / width);
                    if (cx > 0 && binary[current - 1] === 255 && labels[current - 1] === 0) stack.push(current - 1);
                    if (cx < width - 1 && binary[current + 1] === 255 && labels[current + 1] === 0) stack.push(current + 1);
                    if (cy > 0 && binary[current - width] === 255 && labels[current - width] === 0) stack.push(current - width);
                    if (cy < height - 1 && binary[current + width] === 255 && labels[current + width] === 0) stack.push(current + width);
                }
            }
        }
    }

    return { labels, numLabels: currentLabel };
}

function getRegionBoxes(labels: Int32Array, numLabels: number, width: number, height: number): BoundingBox[] {
    const boxes: BoundingBox[] = [];

    for (let label = 1; label <= numLabels; label++) {
        let minRow = height, minCol = width, maxRow = 0, maxCol = 0, found = false;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (labels[y * width + x] === label) {
                    found = true;
                    minRow = Math.min(minRow, y);
                    maxRow = Math.max(maxRow, y);
                    minCol = Math.min(minCol, x);
                    maxCol = Math.max(maxCol, x);
                }
            }
        }

        if (found) boxes.push({ minRow, minCol, maxRow, maxCol });
    }

    return boxes;
}

function mergeOverlapping(regions: BoundingBox[]): BoundingBox[] {
    const panels: BoundingBox[] = [];

    for (const region of regions) {
        let merged = false;

        for (let i = 0; i < panels.length; i++) {
            const a = region, b = panels[i]!;
            if (a.minRow < b.maxRow && a.maxRow > b.minRow && a.minCol < b.maxCol && a.maxCol > b.minCol) {
                panels[i] = {
                    minRow: Math.min(a.minRow, b.minRow),
                    minCol: Math.min(a.minCol, b.minCol),
                    maxRow: Math.max(a.maxRow, b.maxRow),
                    maxCol: Math.max(a.maxCol, b.maxCol),
                };
                merged = true;
                break;
            }
        }

        if (!merged) panels.push({ ...region });
    }

    return panels;
}

type NestedPanels = BoundingBox | NestedPanels[];

function clusterPanels(bboxes: BoundingBox[], axis: "row" | "col" = "row", depth = 0): NestedPanels[] {
    if (depth > 10 || bboxes.length <= 1) {
        const sortKey = axis === "row" ? "minRow" : "minCol";
        return [...bboxes].sort((a, b) => a[sortKey] - b[sortKey]);
    }

    const clusters: BoundingBox[][] = [];

    for (const bbox of bboxes) {
        let added = false;

        for (const cluster of clusters) {
            const aligned = cluster.some((b) =>
                axis === "row"
                    ? b.minRow < bbox.maxRow && bbox.minRow < b.maxRow
                    : b.minCol < bbox.maxCol && bbox.minCol < b.maxCol
            );

            if (aligned) {
                cluster.push(bbox);
                added = true;
                break;
            }
        }

        if (!added) clusters.push([bbox]);
    }

    if (clusters.length === 1 && clusters[0]!.length === bboxes.length) {
        const sortKey = axis === "row" ? "minRow" : "minCol";
        return [...bboxes].sort((a, b) => a[sortKey] - b[sortKey]);
    }

    clusters.sort((a, b) => (axis === "row" ? a[0]!.minRow - b[0]!.minRow : a[0]!.minCol - b[0]!.minCol));

    return clusters.map((c): NestedPanels =>
        c.length > 1 ? clusterPanels(c, axis === "row" ? "col" : "row", depth + 1) : c[0]!
    );
}

function* flattenPanels(nested: NestedPanels[]): Generator<BoundingBox> {
    for (const item of nested) {
        if (Array.isArray(item)) yield* flattenPanels(item);
        else yield item;
    }
}

function generateOverlaySvg(panels: OutputPanel[], width: number, height: number): Buffer {
    const panelRects = panels.map((p, i) => {
        const cornerLen = Math.min(20, p.width / 6, p.height / 6);

        return `
      <!-- Panel ${i + 1} -->
      <rect x="${p.left}" y="${p.top}" width="${p.width}" height="${p.height}" 
            fill="none" stroke="#ff3366" stroke-width="3"/>
      
      <!-- Corner accents -->
      <path d="M${p.left},${p.top + cornerLen} L${p.left},${p.top} L${p.left + cornerLen},${p.top}" 
            fill="none" stroke="#ffdd00" stroke-width="5"/>
      <path d="M${p.left + p.width - cornerLen},${p.top} L${p.left + p.width},${p.top} L${p.left + p.width},${p.top + cornerLen}" 
            fill="none" stroke="#ffdd00" stroke-width="5"/>
      <path d="M${p.left},${p.top + p.height - cornerLen} L${p.left},${p.top + p.height} L${p.left + cornerLen},${p.top + p.height}" 
            fill="none" stroke="#ffdd00" stroke-width="5"/>
      <path d="M${p.left + p.width - cornerLen},${p.top + p.height} L${p.left + p.width},${p.top + p.height} L${p.left + p.width},${p.top + p.height - cornerLen}" 
            fill="none" stroke="#ffdd00" stroke-width="5"/>
      
      <!-- Label -->
      <rect x="${p.left + 8}" y="${p.top + p.height - 62}" width="${130 + (i >= 9 ? 12 : 0)}" height="54" rx="4" 
            fill="rgba(0,0,0,0.85)" stroke="#ff3366" stroke-width="2"/>
      <text x="${p.left + 16}" y="${p.top + p.height - 17}" font-family="Arial, sans-serif" font-size="32" 
            font-weight="bold" fill="white">Panel ${i + 1}</text>
    `;
    }).join('\n');

    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <!-- Title -->

      ${panelRects}
    </svg>`

    return Buffer.from(svg);
}

export async function DetectAndExtractPanels(imagePath: string, deleteOriginal: boolean = false): Promise<DetectResult> {
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

        const processingWidth = Math.min(1500, metadata.width);
        const scale = metadata.width / processingWidth;

        const { data: buffer, info } = await image
            .clone()
            .resize(processingWidth)
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const width = info.width;
        const height = info.height;
        const channels = info.channels;

        const grayscale = rgbToGrayscale(buffer, width, height, channels);

        const edges = cannyEdgeDetection(grayscale, width, height);

        const dilated = dilate(edges, width, height, 2);

        const filled = binaryFillHoles(dilated, width, height);

        const { labels, numLabels } = labelComponents(filled, width, height);

        const regions = getRegionBoxes(labels, numLabels, width, height);
        const merged = mergeOverlapping(regions);

        // Filter small panels (less than 1% of image area)
        const imageArea = width * height;
        const filteredPanels = merged.filter(
            (b) => (b.maxRow - b.minRow) * (b.maxCol - b.minCol) >= 0.01 * imageArea
        );

        const clustered = clusterPanels(filteredPanels);
        const orderedPanels = [...flattenPanels(clustered)];

        // Scale back to original dimensions
        const outputPanels: OutputPanel[] = orderedPanels.map((p) => ({
            left: Math.floor(p.minCol * scale),
            top: Math.floor(p.minRow * scale),
            width: Math.ceil((p.maxCol - p.minCol) * scale),
            height: Math.ceil((p.maxRow - p.minRow) * scale),
        }));


        if (outputPanels.length === 0) {
            return { panels: 0, success: true };
        }

        // Create output directory (same name as image)
        const panelsDir = path.join(dir, name);
        if (!fs.existsSync(panelsDir)) {
            fs.mkdirSync(panelsDir, { recursive: true });
        }

        // Extract and save individual panels
        let count = 1;
        for (const p of outputPanels) {
            const extractRegion = {
                left: Math.max(0, p.left),
                top: Math.max(0, p.top),
                width: Math.min(metadata.width - p.left, p.width),
                height: Math.min(metadata.height - p.top, p.height),
            };

            if (extractRegion.width <= 0 || extractRegion.height <= 0) continue;

            const outputPath = path.join(panelsDir, `${count}${ext}`);
            await sharp(imageBuffer).extract(extractRegion).toFile(outputPath);
            count++;
        }

        // Generate annotated image with SVG overlay
        const overlaySvg = generateOverlaySvg(outputPanels, metadata.width, metadata.height);
        const annotatedPath = path.join(dir, `${name}.png`);

        await sharp(imageBuffer)
            .composite([{ input: overlaySvg, top: 0, left: 0 }])
            .toFile(annotatedPath);


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