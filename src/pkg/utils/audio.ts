import * as fs from "fs";
import * as path from "path";
import wav from "wav";
import { readFileSync } from 'fs';
import { spawn } from "child_process";

export function GetWavDurationFromBuffer(input: Buffer | ArrayBuffer | Uint8Array): number {
    const buffer = Buffer.from(input instanceof ArrayBuffer ? input : input.buffer);

    const byteRate = buffer.readUInt32LE(28);
    const dataSize = buffer.readUInt32LE(40);

    return dataSize / byteRate;
}

export function SaveWaveFile(
    filename: any,
    pcmData: any,
    channels = 1,
    rate = 24000,
    sampleWidth = 2,
) {
    return new Promise((resolve, reject) => {
        const writer = new wav.FileWriter(filename, {
            channels,
            sampleRate: rate,
            bitDepth: sampleWidth * 8,
        });

        writer.on('finish', resolve);
        writer.on('error', reject);

        writer.write(pcmData);
        writer.end();
    });
}


export function MergeWavFiles(inputFiles: string[], outputFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (inputFiles.length === 0) {
            return reject(new Error("No input files provided"));
        }

        // Force WAV format for each input to prevent misdetection
        const inputArgs = inputFiles.flatMap((file) => ["-f", "wav", "-i", file]);
        const filterInputs = inputFiles.map((_, i) => `[${i}:0]`).join("");
        const filterComplex = `${filterInputs}concat=n=${inputFiles.length}:v=0:a=1[out]`;

        const args = [
            "-y", // Overwrite output without asking
            ...inputArgs,
            "-filter_complex", filterComplex,
            "-map", "[out]",
            outputFile,
        ];

        const ffmpeg = spawn("ffmpeg", args);

        ffmpeg.stderr.on("data", (data) => {
            console.log(`ffmpeg: ${data}`);
        });

        ffmpeg.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`ffmpeg exited with code ${code}`));
            }
        });

        ffmpeg.on("error", (err) => {
            reject(new Error(`Failed to start ffmpeg: ${err.message}`));
        });
    });
}
