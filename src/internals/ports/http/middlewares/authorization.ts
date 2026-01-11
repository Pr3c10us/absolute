import type { NextFunction, Request, Response } from "express";
import { BadRequestError, UnAuthorizedError } from "../../../../pkg/errors";
import { verifyEmailToken, verifyToken } from "../../../../pkg/utils/encryption";
import type Payload from "../../../../pkg/types/payload";
import AccountServices from "../../../services/authentication";
import { IncomingMessage } from "http";
import { z } from "zod";

export const Authorize = (services: AccountServices) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        let { token } = req.signedCookies;
        if (!token) {
            token = req.headers.authorization?.split(" ")[1];
        }
        if (!token) {
            token = req.query.token;
        }
        if (!token) throw new UnAuthorizedError("session has expired");

        try {
            const jwtPayload = verifyToken(token);
            const payload: Payload = jwtPayload as Payload;

            req.user = await services.queries.getDetails.handle({ id: payload.id });
            next();
        } catch (error) {
            throw error;
        }
    };
};

export const AuthorizeEmailToken = (services: AccountServices) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        let token: any = req.headers.authorization?.split(" ")[1];

        if (!token) {
            token = req.query.token;
        }
        if (!token) throw new UnAuthorizedError("token has expired");

        try {
            const jwtPayload = verifyEmailToken(token);
            const payload: Payload = jwtPayload as Payload;

            req.user = await services.queries.getDetails.handle({ id: payload.id });
            next();
        } catch (error) {
            throw new UnAuthorizedError("token has expired");
            throw error;
        }
    };
}
    ;

export const AuthorizeRefreshToken = (services: AccountServices) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        let { refreshToken } = req.signedCookies;
        if (!refreshToken) {
            refreshToken = req.headers.authorization?.split(" ")[1];
        }
        if (!refreshToken) {
            refreshToken = req.query.refreshToken;
        }
        if (!refreshToken) throw new UnAuthorizedError("session has expired");

        try {
            const jwtPayload = verifyToken(refreshToken);
            const payload: Payload = jwtPayload as Payload;

            req.user = await services.queries.getDetails.handle({ id: payload.id });
            next();
        } catch (error) {
            throw error;
        }
    };
};