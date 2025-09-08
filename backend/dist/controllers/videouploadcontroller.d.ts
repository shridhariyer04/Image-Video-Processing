import { Request, Response, NextFunction } from "express";
export declare function handleVideoUpload(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare const videoRouter: import("express-serve-static-core").Router;
export default videoRouter;
