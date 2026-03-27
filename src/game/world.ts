import { TBWObject, TBWEnvironment } from './tbwObjects'; // Assuming these are defined in another file

export class GameWorld {
    private gravity: number;
    private deathLimitLow: number;
    private deathLimitHigh: number;
    private respawnTime: number;
    private objects: TBWObject[];
    private environment: TBWEnvironment;

    constructor() {
        this.gravity = 9.81; // Default gravity
        this.deathLimitLow = 0; // Default death limit low
        this.deathLimitHigh = 100; // Default death limit high
        this.respawnTime = 5; // Default respawn time in seconds
        this.objects = [];
        this.environment = new TBWEnvironment(); // Initialize with default environment
    }

    public loadWorld(tbwData: string): void {
        // Parse TBW data and load world properties
        // This method should handle the parsing of the TBW file format
        // and instantiate objects and environment settings accordingly
    }

    public setGravity(gravity: number): void {
        this.gravity = gravity;
    }

    public getGravity(): number {
        return this.gravity;
    }

    public setDeathLimits(low: number, high: number): void {
        this.deathLimitLow = low;
        this.deathLimitHigh = high;
    }

    public getDeathLimits(): { low: number; high: number } {
        return { low: this.deathLimitLow, high: this.deathLimitHigh };
    }

    public setRespawnTime(time: number): void {
        this.respawnTime = time;
    }

    public getRespawnTime(): number {
        return this.respawnTime;
    }

    public addObject(obj: TBWObject): void {
        this.objects.push(obj);
    }

    public getObjects(): TBWObject[] {
        return this.objects;
    }

    public setEnvironment(env: TBWEnvironment): void {
        this.environment = env;
    }

    public getEnvironment(): TBWEnvironment {
        return this.environment;
    }
}