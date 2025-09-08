import { Request, Response, NextFunction } from "express";
export declare function handleUpload(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare const imageRouter: import("express-serve-static-core").Router;
export default imageRouter;
