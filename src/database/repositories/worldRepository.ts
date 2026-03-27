import { getDatabase } from "../connection";

export interface World {
  id: number;
  name: string;
  featured: boolean;
  date: string; // ISO date string
  downloads: number;
  version: string;
  author: string;
  image: string; // base64 or URL
  tbw: string; // TBW map data
  reports: number;
  updated_at: string; // ISO datetime string
}

export interface CreateWorldInput {
  name: string;
  featured?: boolean;
  version: string;
  author: string;
  image: string;
  tbw: string;
}

export interface UpdateWorldInput {
  name?: string;
  featured?: boolean;
  version?: string;
  author?: string;
  image?: string;
  tbw?: string;
}

export class WorldRepository {
  private db = getDatabase();

  createWorld(input: CreateWorldInput): World {
    const stmt = this.db.prepare(`
      INSERT INTO worlds (name, featured, date, downloads, version, author, image, tbw, reports, updated_at)
      VALUES (?, ?, DATE('now'), 0, ?, ?, ?, ?, 0, DATETIME('now'))
    `);

    const result = stmt.run(
      input.name,
      input.featured ? 1 : 0,
      input.version,
      input.author,
      input.image,
      input.tbw
    );

    return this.getWorldById(Number(result.lastInsertRowid))!;
  }

  getWorldById(id: number): World | null {
    const stmt = this.db.prepare("SELECT * FROM worlds WHERE id = ?");
    const world = stmt.get(id) as any;
    if (!world) return null;
    return this.mapToWorld(world);
  }

  getAllWorlds(featured?: boolean): World[] {
    let query = "SELECT * FROM worlds";
    const params: any[] = [];

    if (featured !== undefined) {
      query += " WHERE featured = ?";
      params.push(featured ? 1 : 0);
    }

    query += " ORDER BY updated_at DESC";

    const stmt = this.db.prepare(query);
    const worlds = stmt.all(...params) as any[];
    return worlds.map((w) => this.mapToWorld(w));
  }

  searchWorlds(searchTerm: string): World[] {
    const stmt = this.db.prepare(`
      SELECT * FROM worlds
      WHERE name LIKE ? OR author LIKE ?
      ORDER BY downloads DESC, updated_at DESC
    `);
    const searchPattern = `%${searchTerm}%`;
    const worlds = stmt.all(searchPattern, searchPattern) as any[];
    return worlds.map((w) => this.mapToWorld(w));
  }

  updateWorld(id: number, input: UpdateWorldInput): World | null {
    const updates: string[] = [];
    const params: any[] = [];

    if (input.name !== undefined) {
      updates.push("name = ?");
      params.push(input.name);
    }
    if (input.featured !== undefined) {
      updates.push("featured = ?");
      params.push(input.featured ? 1 : 0);
    }
    if (input.version !== undefined) {
      updates.push("version = ?");
      params.push(input.version);
    }
    if (input.author !== undefined) {
      updates.push("author = ?");
      params.push(input.author);
    }
    if (input.image !== undefined) {
      updates.push("image = ?");
      params.push(input.image);
    }
    if (input.tbw !== undefined) {
      updates.push("tbw = ?");
      params.push(input.tbw);
    }

    if (updates.length === 0) {
      return this.getWorldById(id);
    }

    updates.push("updated_at = DATETIME('now')");
    params.push(id);

    const stmt = this.db.prepare(`
      UPDATE worlds
      SET ${updates.join(", ")}
      WHERE id = ?
    `);

    stmt.run(...params);
    return this.getWorldById(id);
  }

  deleteWorld(id: number): boolean {
    const stmt = this.db.prepare("DELETE FROM worlds WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  incrementDownloads(id: number): void {
    const stmt = this.db.prepare(`
      UPDATE worlds
      SET downloads = downloads + 1, updated_at = DATETIME('now')
      WHERE id = ?
    `);
    stmt.run(id);
  }

  incrementReports(id: number): void {
    const stmt = this.db.prepare(`
      UPDATE worlds
      SET reports = reports + 1, updated_at = DATETIME('now')
      WHERE id = ?
    `);
    stmt.run(id);
  }

  private mapToWorld(row: any): World {
    return {
      id: row.id,
      name: row.name,
      featured: Boolean(row.featured),
      date: row.date,
      downloads: row.downloads,
      version: row.version,
      author: row.author,
      image: row.image,
      tbw: row.tbw,
      reports: row.reports,
      updated_at: row.updated_at,
    };
  }
}
