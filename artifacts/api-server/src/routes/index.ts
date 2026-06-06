import { Router, type IRouter } from "express";
import healthRouter from "./health";
import signalingRouter from "./signaling";
import decartRouter from "./decart";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/signaling", signalingRouter);
router.use("/decart", decartRouter);

export default router;
