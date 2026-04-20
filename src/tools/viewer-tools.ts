import { z } from "zod";
import mineflayer from 'mineflayer';
import { ToolFactory } from '../tool-factory.js';

let viewerInstance: any = null;
let prismarineViewer: any = null;

export function registerViewerTools(factory: ToolFactory, getBot: () => mineflayer.Bot, getViewerPort: () => number): void {
  /**
   * Initialize or get the web viewer URL for real-time game view
   */
  factory.registerTool(
    "get-viewer-url",
    "Get the URL for the web-based game viewer (prismarine-viewer)",
    {},
    async () => {
      const bot = getBot();
      const port = getViewerPort();

      if (!bot || bot.entity === undefined) {
        return factory.createErrorResponse("Bot not spawned yet");
      }

      // Lazy load and initialize viewer
      if (!prismarineViewer) {
        try {
          prismarineViewer = require('prismarine-viewer').mineflayer;
        } catch (e) {
          return factory.createErrorResponse("prismarine-viewer not installed. Run: npm install prismarine-viewer");
        }
      }

      if (!viewerInstance) {
        try {
          viewerInstance = prismarineViewer(bot, { port });
          return factory.createResponse(`Web viewer initialized at http://localhost:${port}\n\nOpen this URL in a browser to see the bot's view in real-time.\n\nNote: If the port is already in use, the server will use a different port.`);
        } catch (e) {
          const err = e as Error;
          if (err.message.includes('EADDRINUSE') || err.message.includes('address already in use')) {
            return factory.createResponse(`Viewer port ${port} is already in use. Try stopping other processes using this port, or use get-viewer-url to get the current viewer URL.`);
          }
          return factory.createErrorResponse(`Failed to start viewer: ${err.message}`);
        }
      }

      return factory.createResponse(`Web viewer is running at http://localhost:${port}\n\nOpen this URL in a browser to see the bot's view in real-time.`);
    }
  );

  /**
   * Get current game state information for AI decision making
   */
  factory.registerTool(
    "get-game-state",
    "Get comprehensive information about the bot's current state for AI decision making",
    {},
    async () => {
      const bot = getBot();

      if (!bot || bot.entity === undefined) {
        return factory.createErrorResponse("Bot not spawned yet");
      }

      const pos = bot.entity.position;
      const vel = bot.entity.velocity;
      const yaw = bot.entity.yaw;
      const pitch = bot.entity.pitch;

      const health = bot.health;
      const food = (bot as any).food ?? 20;
      const xp = (bot as any).experience?.points ?? 0;
      const level = (bot as any).experience?.level ?? 0;

      // Use bot.game.gameMode() if it's a function
      let gamemode = 'unknown';
      try {
        if (typeof (bot.game as any).gameMode === 'function') {
          gamemode = (bot.game as any).gameMode();
        }
      } catch (e) {
        gamemode = 'unknown';
      }

      const isOnGround = bot.entity.onGround;
      // Check if entity is in water using the block type at entity position
      const blockBelow = bot.blockAt(pos.offset(0, -0.5, 0));
      const isInWater = blockBelow?.name === 'water';

      // Get nearby entities
      const entities = Object.values(bot.entities);
      const nearbyPlayers = entities
        .filter((e: any) => e.type === 'player' && e.username !== bot.username)
        .map((e: any) => ({ name: e.username, distance: Math.round(pos.distanceTo(e.position) * 10) / 10 }))
        .sort((a: any, b: any) => a.distance - b.distance)
        .slice(0, 5);

      // Get held item
      const heldItem = bot.heldItem ? `${bot.heldItem.name} x${bot.heldItem.count}` : 'empty';

      let text = `Bot State:\n\n`;
      text += `Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})\n`;
      text += `Velocity: (${vel.x.toFixed(1)}, ${vel.y.toFixed(1)}, ${vel.z.toFixed(1)})\n`;
      text += `Rotation: yaw=${(yaw * 180 / Math.PI).toFixed(0)}°, pitch=${(pitch * 180 / Math.PI).toFixed(0)}°\n\n`;

      text += `Status:\n`;
      text += `  Health: ${health?.toFixed(1) ?? 'unknown'}/20\n`;
      text += `  Food: ${food}/20\n`;
      text += `  XP Level: ${level}\n`;
      text += `  Game Mode: ${gamemode}\n`;
      text += `  Held Item: ${heldItem}\n`;
      text += `  On Ground: ${isOnGround}\n`;
      text += `  In Water: ${isInWater}\n\n`;

      if (nearbyPlayers.length > 0) {
        text += `Nearby Players:\n`;
        nearbyPlayers.forEach((p: any) => {
          text += `  ${p.name} - ${p.distance} blocks away\n`;
        });
      } else {
        text += `Nearby Players: none\n`;
      }

      return factory.createResponse(text);
    }
  );

  /**
   * Detect blocks around the bot (simplified scan)
   */
  factory.registerTool(
    "scan-area",
    "Scan the area around the bot and report notable blocks",
    {
      radius: z.coerce.number().int().positive().optional().describe("Scan radius (default: 5, max: 15)"),
    },
    async ({ radius = 5 }) => {
      const bot = getBot();

      if (!bot || bot.entity === undefined) {
        return factory.createErrorResponse("Bot not spawned yet");
      }

      const scanRadius = Math.min(radius, 15);
      const pos = bot.entity.position;

      const notableBlocks: { name: string; x: number; y: number; z: number; distance: number }[] = [];
      const blockTypes: Record<string, number> = {};

      for (let x = -scanRadius; x <= scanRadius; x++) {
        for (let y = -scanRadius; y <= scanRadius; y++) {
          for (let z = -scanRadius; z <= scanRadius; z++) {
            const checkPos = pos.offset(x, y, z);
            const block = bot.blockAt(checkPos);
            if (block && block.name !== 'air') {
              notableBlocks.push({
                name: block.name,
                x: Math.floor(block.position.x),
                y: Math.floor(block.position.y),
                z: Math.floor(block.position.z),
                distance: Math.round(Math.sqrt(x*x + y*y + z*z) * 10) / 10
              });
              blockTypes[block.name] = (blockTypes[block.name] || 0) + 1;
            }
          }
        }
      }

      if (notableBlocks.length === 0) {
        return factory.createResponse(`No notable blocks found within ${scanRadius} blocks`);
      }

      let text = `Area Scan (radius: ${scanRadius}, total blocks: ${notableBlocks.length}):\n\n`;
      text += `Block Types Found:\n`;
      Object.entries(blockTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([name, count]) => {
          text += `  ${name}: ${count}\n`;
        });

      text += `\nNearest Notable Blocks:\n`;
      notableBlocks
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5)
        .forEach((b) => {
          text += `  ${b.name} at (${b.x}, ${b.y}, ${b.z}) - ${b.distance} blocks\n`;
        });

      return factory.createResponse(text);
    }
  );
}

export function getViewerPortFromConfig(): number {
  return parseInt(process.env.VIEWER_PORT || '3000');
}
