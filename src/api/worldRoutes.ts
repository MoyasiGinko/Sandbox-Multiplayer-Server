import { Router, Request, Response } from "express";
import { WorldRepository } from "../database/repositories/worldRepository";
import { authenticateToken, AuthRequest } from "../auth/middleware";

const router = Router();
const worldRepo = new WorldRepository();

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

// Create new world (requires authentication)
router.post("/", authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const { name, featured, version, author, image, tbw } = req.body;

    // Validate required fields
    if (!name || !version || !author || !image || !tbw) {
      res.status(400).json({
        error: "Missing required fields: name, version, author, image, tbw",
      });
      return;
    }

    // Use authenticated user as author if not provided
    const worldAuthor = author || req.user?.username;

    const world = worldRepo.createWorld({
      name,
      featured: featured || false,
      version,
      author: worldAuthor,
      image,
      tbw,
    });

    console.log(`[WorldAPI] Created world: ${world.name} by ${world.author}`);
    res.status(201).json({ success: true, world });
  } catch (error) {
    console.error("[WorldAPI] Error creating world:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update world (requires authentication)
router.put("/:id", authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const worldId = parseInt(req.params.id, 10);

    if (isNaN(worldId)) {
      res.status(400).json({ error: "Invalid world ID" });
      return;
    }

    const existingWorld = worldRepo.getWorldById(worldId);

    if (!existingWorld) {
      res.status(404).json({ error: "World not found" });
      return;
    }

    // Optional: Check if user is author or admin
    // if (existingWorld.author !== req.user?.username) {
    //   return res.status(403).json({ error: "Not authorized to update this world" });
    // }

    const { name, featured, version, author, image, tbw } = req.body;

    const updatedWorld = worldRepo.updateWorld(worldId, {
      name,
      featured,
      version,
      author,
      image,
      tbw,
    });

    console.log(`[WorldAPI] Updated world: ${worldId}`);
    res.json({ success: true, world: updatedWorld });
  } catch (error) {
    console.error("[WorldAPI] Error updating world:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete world (requires authentication)
router.delete("/:id", authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const worldId = parseInt(req.params.id, 10);

    if (isNaN(worldId)) {
      res.status(400).json({ error: "Invalid world ID" });
      return;
    }

    const existingWorld = worldRepo.getWorldById(worldId);

    if (!existingWorld) {
      res.status(404).json({ error: "World not found" });
      return;
    }

    // Optional: Check if user is author or admin
    // if (existingWorld.author !== req.user?.username) {
    //   return res.status(403).json({ error: "Not authorized to delete this world" });
    // }

    const deleted = worldRepo.deleteWorld(worldId);

    if (deleted) {
      console.log(`[WorldAPI] Deleted world: ${worldId}`);
      res.json({ success: true, message: "World deleted successfully" });
    } else {
      res.status(500).json({ error: "Failed to delete world" });
    }
  } catch (error) {
    console.error("[WorldAPI] Error deleting world:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Increment download count
router.post("/:id/download", async (req: Request, res: Response) => {
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

    worldRepo.incrementDownloads(worldId);
    const updatedWorld = worldRepo.getWorldById(worldId);

    res.json({ success: true, world: updatedWorld });
  } catch (error) {
    console.error("[WorldAPI] Error incrementing downloads:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Report world
router.post("/:id/report", async (req: Request, res: Response) => {
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

    worldRepo.incrementReports(worldId);
    console.log(`[WorldAPI] World ${worldId} reported`);

    res.json({ success: true, message: "Report submitted successfully" });
  } catch (error) {
    console.error("[WorldAPI] Error reporting world:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
