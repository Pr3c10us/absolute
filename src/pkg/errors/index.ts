import {StatusCodes} from "http-status-codes";

export class ApiError extends Error {
    statusCode: number;

    constructor(message: string) {
        super(message);
        this.statusCode = StatusCodes.INTERNAL_SERVER_ERROR;
    }
}

export class NotFoundError extends ApiError {
    constructor(message: string) {
        super(message);
        this.statusCode = StatusCodes.NOT_FOUND;
    }
}

export class BadRequestError extends ApiError {
    constructor(message: string) {
        super(message);
        this.statusCode = StatusCodes.BAD_REQUEST;
    }
}

export class UnAuthorizedError extends ApiError {
    constructor(message: string) {
        super(message);
        this.statusCode = StatusCodes.UNAUTHORIZED;
    }
}

export class ForbiddenError extends ApiError {
    constructor(message: string) {
        super(message);
        this.statusCode = StatusCodes.FORBIDDEN;
    }
}

export class AIRateLimitError extends ApiError {
    constructor(message: string) {
        super(message);
        this.statusCode = StatusCodes.FORBIDDEN;
    }
}

export class DuplicateError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class NothingToSegmentError extends Error {
    constructor() {
        super("nothing to segment");
    }
}

export class InvalidSegmentsError extends Error {
    constructor() {
        super("invalid segment");
    }
}

export class InvalidMilestonesError extends Error {
    constructor() {
        super("invalid milestone generated");
    }
}

export class InvalidMilestonesReferenceError extends Error {
    constructor() {
        super("invalid milestone references generated");
    }
}

export class InvalidChallengesError extends Error {
    constructor() {
        super("invalid challenge generated");
    }
}

export class InvalidAssessmentsError extends Error {
    constructor() {
        super("failed to generate feedback, try again");
    }
}

