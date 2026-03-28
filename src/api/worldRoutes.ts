import { Router, Request, Response } from "express";
import { WorldRepository } from "../database/repositories/worldRepository";

const router = Router();
const worldRepo = new WorldRepository();

function deprecatedWorldWriteResponse(res: Response): void {
  res.status(410).json({
    error: "deprecated_endpoint",
    message:
      "Node world write endpoints are disabled. Use Django world endpoints for create/update/delete/download/report.",
  });
}

// Get all worlds (optional: filter by featured)
router.get("/", async (req: Request, res: Response) => {
  try {
    const featured =
      req.query.featured === "true"
        ? true
        : req.query.featured === "false"
          ? false
          : undefined;

    const worlds = worldRepo.getAllWorlds(featured);
    res.json({ success: true, worlds });
  } catch (error) {
    console.error("[WorldAPI] Error fetching worlds:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Search worlds by name or author
router.get("/search", async (req: Request, res: Response) => {
  try {
    const searchTerm = req.query.q as string;

    if (!searchTerm || searchTerm.trim() === "") {
      res.status(400).json({ error: "Search term is required" });
      return;
    }

    const worlds = worldRepo.searchWorlds(searchTerm);
    res.json({ success: true, worlds });
  } catch (error) {
    console.error("[WorldAPI] Error searching worlds:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get specific world by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const worldId = parseInt(req.params.id, 10);

    if (isNaN(worldId)) {
      res.status(400).json({ error: "Invalid world ID" });
      return;
    }

    const world = worldRepo.getWorldById(worldId);

    if (!world) {
      res.status(404).json({ error: "World not found" });
      return;
    }

    res.json({ success: true, world });
  } catch (error) {
    console.error("[WorldAPI] Error fetching world:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create new world endpoint is intentionally disabled.
router.post("/", (_req: Request, res: Response) => {
  deprecatedWorldWriteResponse(res);
});

// Update world endpoint is intentionally disabled.
router.put("/:id", (_req: Request, res: Response) => {
  deprecatedWorldWriteResponse(res);
});

// Delete world endpoint is intentionally disabled.
router.delete("/:id", (_req: Request, res: Response) => {
  deprecatedWorldWriteResponse(res);
});

// Download/report mutations are disabled to avoid data drift from Django authority.
router.post("/:id/download", (_req: Request, res: Response) => {
  deprecatedWorldWriteResponse(res);
});

router.post("/:id/report", (_req: Request, res: Response) => {
  deprecatedWorldWriteResponse(res);
});

export default router;
