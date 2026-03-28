import { Router, Request, Response } from "express";

const router = Router();

function deprecatedWorldResponse(res: Response): void {
  res.status(410).json({
    error: "deprecated_endpoint",
    message:
      "Node world endpoints are disabled. Use Django world endpoints for world read/write operations.",
  });
}

router.get("/", (_req: Request, res: Response) => {
  deprecatedWorldResponse(res);
});

router.get("/search", (_req: Request, res: Response) => {
  deprecatedWorldResponse(res);
});

router.get("/:id", (_req: Request, res: Response) => {
  deprecatedWorldResponse(res);
});

// Create new world endpoint is intentionally disabled.
router.post("/", (_req: Request, res: Response) => {
  deprecatedWorldResponse(res);
});

// Update world endpoint is intentionally disabled.
router.put("/:id", (_req: Request, res: Response) => {
  deprecatedWorldResponse(res);
});

// Delete world endpoint is intentionally disabled.
router.delete("/:id", (_req: Request, res: Response) => {
  deprecatedWorldResponse(res);
});

// Download/report mutations are disabled to avoid data drift from Django authority.
router.post("/:id/download", (_req: Request, res: Response) => {
  deprecatedWorldResponse(res);
});

router.post("/:id/report", (_req: Request, res: Response) => {
  deprecatedWorldResponse(res);
});

export default router;
