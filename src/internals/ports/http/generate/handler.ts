import {type Request, type Response, Router, type NextFunction} from "express";

import multer from "multer";
import {UploadCleanupFiles, UploadErrorCleanup} from "../middlewares/upload.ts";
import ExtractCBR from "../../../../pkg/utils/extractCBR.ts";
import GenerateServices from "../../../services/generate/generate.ts";

export default class GenerateHandler {
    router = Router()

    constructor(
        private readonly generateService: GenerateServices
    ) {
        this.configureRoutes()
    }

    private configureRoutes() {
        this.router.route('/')
            .post(
                multer({
                    storage: multer.diskStorage({
                        destination: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
                            cb(null, `uploads`);
                        },
                        filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
                            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                            cb(null, file.originalname);
                        }
                    }),
                    limits: {fileSize: 1024 * 1024 * 1024},
                }).array('files', 5),
                UploadCleanupFiles,
                this.generate,
                UploadErrorCleanup
            )
    }

    generate = async (req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const abortController = new AbortController();

        req.on('close', () => {
            abortController.abort();
        });

        try {
            if (req.files) {
                let files = []
                for (const file of req.files as Express.Multer.File[]) {
                    files.push({path: file.path, mimeType: file.mimetype})
                }
                let events = this.generateService.commands.generate.handle(files, req.body.voice,req.body.voiceStyleInstruction,req.body.context, abortController)
                for await (const {event, data} of events) {
                    res.write(`event: ${event}\n`);
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                }
            }
            res.end();
        } catch (err) {
            console.log(err)
            // Headers already sent - send error through the stream instead
            if (res.headersSent) {
                res.write(`event: error\n`);
                res.write(`data: ${JSON.stringify({ message: err instanceof Error ? err.message : 'Unknown error' })}\n\n`);
                res.end();
            } else {
                // Headers not sent yet - let error middleware handle it
                next(err);
            }
        }
    }
}