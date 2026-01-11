import {type NextFunction, type Request, type Response, Router} from "express";
import * as fs from "node:fs/promises";

export const UploadCleanupFiles = (req: Request, res: Response, next: NextFunction) => {
    const cleanup = async () => {
        try {
            if (req.files && Array.isArray(req.files)) {
                for (const file of req.files as Express.Multer.File[]) {
                    try {
                        await fs.unlink(file.path);
                    } catch (error) {
                    }
                }
            }

            if (req.file) {
                try {
                    await fs.unlink(req.file.path);
                } catch (error) {
                }
            }
        } catch (error) {
        }
    };

    res.on('finish', () => {
        cleanup();
    });

    res.on('close', () => {
        cleanup();
    });

    next();
};

export const UploadErrorCleanup = async (err: any, req: Request, res: Response, next: NextFunction) => {
    try {
        if (req.files && Array.isArray(req.files)) {
            for (const file of req.files as Express.Multer.File[]) {
                try {
                    await fs.unlink(file.path);
                } catch (cleanupError) {
                }
            }
        }

        if (req.file) {
            try {
                await fs.unlink(req.file.path);
            } catch (cleanupError) {
            }
        }
    } catch (error) {
    }

    next(err);
};
