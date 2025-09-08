"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
const { combine, timestamp, printf, colorize } = winston_1.default.format;
// Custom log format with timestamp, colors, and metadata
const logFormat = printf(({ level, message, timestamp, ...meta }) => {
    const metaString = Object.keys(meta).length ? JSON.stringify(meta) : "";
    return `${timestamp} [${level}]: ${message} ${metaString}`;
});
const logger = winston_1.default.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: combine(colorize(), // pretty colors in console
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
    transports: [
        new winston_1.default.transports.Console(),
        new winston_1.default.transports.File({
            filename: "logs/error.log",
            level: "error",
            format: combine(timestamp(), winston_1.default.format.json()), // structured logs
        }),
        new winston_1.default.transports.File({
            filename: "logs/combined.log",
            format: combine(timestamp(), winston_1.default.format.json()),
        }),
    ],
});
exports.default = logger;
