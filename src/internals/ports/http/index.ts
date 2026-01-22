import express, { type Express } from "express";
import AppSecrets from "../../../pkg/secret";
import { StatusCodes } from "http-status-codes";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import cors from 'cors'
import MorganMiddleware from "./middlewares/morgan.ts";
import ErrorHandlerMiddleware from "./middlewares/errorHandler.ts";
import Route404 from "./middlewares/invalidRoute.ts";
import passport from "passport";
import type Services from "../../services";
import http from "http";
import { WebSocketServer } from "ws";
import type Adapters from "../../adapters";
import rateLimit from "express-rate-limit";
import GenerateHandler from "./generate/handler.ts";
import path from "path";

export default class ExpressHTTP {
    appSecrets: AppSecrets
    services: Services
    adapters: Adapters
    server: Express;
    bareServer: http.Server
    websocketServer: WebSocketServer

    router = express.Router();

    constructor(appSecrets: AppSecrets, services: Services, adapters: Adapters) {
        this.appSecrets = appSecrets
        this.services = services
        this.adapters = adapters
        this.server = express();
        this.bareServer = http.createServer(this.server)
        this.websocketServer = new WebSocketServer({ server: this.bareServer })  // Single server

        // Middlewares
        this.server.set('trust proxy', 1)
        this.server.use(express.json());
        this.server.use(express.urlencoded({ extended: true }));
        this.server.use(helmet({
            contentSecurityPolicy: false
        }));
        this.server.use(rateLimit({
            windowMs: 60 * 1000,
            max: 100,
            standardHeaders: true,
            legacyHeaders: false,
            message: { error: 'Too many requests, please try again later.' }
        }))
        let morganMiddleware = new MorganMiddleware()
        this.server.use(morganMiddleware.middleware)

        // Passport
        this.server.use(passport.initialize());

        this.server.use('/results', express.static(
            path.join(process.cwd(), 'results')
        ));

        this.ui()
        this.health()
        this.generate()

        this.server.use(`/api/v1`, this.router);

        this.server.use(Route404);
        this.server.use(ErrorHandlerMiddleware);
    }

    listen() {
        this.bareServer.listen(this.appSecrets.port, () => {
            console.log(`Application started: http://localhost:${this.appSecrets.port}`);
        })
    }

    ui() {
        this.server.get('/', async (req, res) => {
            return res.sendFile(__dirname + '/views/page.html');
        })
    }

    health() {
        this.server.get('/health', async (req, res) => {
            console.log(path.join(__dirname, "..", "..", "..", 'results'),)
            return res.status(StatusCodes.OK).send("server up")
        })
    }

    generate = () => {
        const router = new GenerateHandler(this.services.GenerateServices);
        this.router.use("/generate", router.router);
    };
}