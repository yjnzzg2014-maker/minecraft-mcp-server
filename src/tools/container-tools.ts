import { z } from "zod";
import mineflayer from 'mineflayer';
import { ToolFactory } from '../tool-factory.js';

// Store the currently open container reference
let openContainer: any = null;
let openContainerBlock: any = null;

export function registerContainerTools(factory: ToolFactory, getBot: () => mineflayer.Bot): void {
  /**
   * Open a container (chest, furnace, etc.) at the specified position
   */
  factory.registerTool(
    "open-container",
    "Open a container (chest, furnace, barrel, hopper, etc.) at the specified position",
    {
      x: z.coerce.number().describe("X coordinate of the container"),
      y: z.coerce.number().describe("Y coordinate of the container"),
      z: z.coerce.number().describe("Z coordinate of the container"),
    },
    async ({ x, y, z }) => {
      const bot = getBot();
      const Vec3 = require('vec3');
      const pos = new Vec3(x, y, z);
      const block = bot.blockAt(pos);

      if (!block) {
        return factory.createErrorResponse(`No block found at position (${x}, ${y}, ${z})`);
      }

      const containerNames = ['chest', 'ender_chest', 'furnace', 'blast_furnace', 'smoker', 'barrel', 'hopper', 'dropper', 'dispenser'];
      if (!containerNames.includes(block.name)) {
        return factory.createErrorResponse(`Block at (${x}, ${y}, ${z}) is not a container (found: ${block.name})`);
      }

      try {
        openContainer = await bot.openContainer(block);
        openContainerBlock = block;
        const itemCount = openContainer.slots.filter((s: any) => s !== null).length;
        return factory.createResponse(`Opened ${block.name} at (${x}, ${y}, ${z}). Items: ${itemCount} slots used\nContainer reference stored for subsequent operations.`);
      } catch (e) {
        openContainer = null;
        openContainerBlock = null;
        return factory.createErrorResponse(`Failed to open container: ${(e as Error).message}`);
      }
    }
  );

  /**
   * Get the contents of an open container
   */
  factory.registerTool(
    "get-container-contents",
    "Get the contents of an open container (must be called immediately after open-container)",
    {},
    async () => {
      if (!openContainer) {
        return factory.createErrorResponse("No container is currently open. Call open-container first.");
      }

      const items: { name: string; count: number; slot: number; metadata?: number }[] = [];
      for (let i = 0; i < openContainer.slots.length; i++) {
        const item = openContainer.slots[i];
        if (item) {
          items.push({
            name: item.name,
            count: item.count,
            slot: i,
            metadata: item.metadata
          });
        }
      }

      if (items.length === 0) {
        return factory.createResponse(`${openContainer.name || 'Container'} is empty`);
      }

      let text = `${openContainer.name || 'Container'} contents (${items.length} items):\n\n`;
      items.forEach((item: any) => {
        text += `  Slot ${item.slot}: ${item.name} x${item.count}\n`;
      });

      return factory.createResponse(text);
    }
  );

  /**
   * Move items from container to bot's inventory
   */
  factory.registerTool(
    "withdraw-from-container",
    "Withdraw items from an open container into the bot's inventory",
    {
      itemName: z.string().describe("Name of the item to withdraw"),
      count: z.coerce.number().int().positive().optional().describe("Number of items to withdraw (default: all available)"),
      sourceSlot: z.coerce.number().int().optional().describe("Specific slot to withdraw from (optional)"),
    },
    async ({ itemName, count, sourceSlot }) => {
      if (!openContainer) {
        return factory.createErrorResponse("No container is currently open. Call open-container first.");
      }

      try {
        let item;
        let fromSlot;

        if (sourceSlot !== undefined) {
          item = openContainer.slots[sourceSlot];
          fromSlot = sourceSlot;
        } else {
          for (let i = 0; i < openContainer.slots.length; i++) {
            const slotItem = openContainer.slots[i];
            if (slotItem && slotItem.name.includes(itemName.toLowerCase())) {
              item = slotItem;
              fromSlot = i;
              break;
            }
          }
        }

        if (!item) {
          return factory.createErrorResponse(`No ${itemName} found in container`);
        }

        const withdrawCount = count ?? item.count;
        const itemToMove = openContainer.slots[fromSlot!];
        await openContainer.withdraw(itemToMove.type, itemToMove.metadata ?? 0, Math.min(withdrawCount, itemToMove.count));

        return factory.createResponse(`Withdrew ${Math.min(withdrawCount, itemToMove.count)} ${item.name} from slot ${fromSlot}`);
      } catch (e) {
        return factory.createErrorResponse(`Failed to withdraw: ${(e as Error).message}`);
      }
    }
  );

  /**
   * Deposit items from bot's inventory into open container
   */
  factory.registerTool(
    "deposit-to-container",
    "Deposit items from the bot's inventory into an open container",
    {
      itemName: z.string().describe("Name of the item to deposit"),
      count: z.coerce.number().int().positive().optional().describe("Number of items to deposit (default: all available)"),
    },
    async ({ itemName, count }) => {
      if (!openContainer) {
        return factory.createErrorResponse("No container is currently open. Call open-container first.");
      }

      try {
        const bot = getBot();
        const botItems = bot.inventory.items();
        const item = botItems.find((i: any) => i.name.includes(itemName.toLowerCase()));

        if (!item) {
          return factory.createErrorResponse(`No ${itemName} found in bot's inventory`);
        }

        const depositCount = count ?? item.count;
        await openContainer.deposit(item.type, item.metadata ?? 0, Math.min(depositCount, item.count));

        return factory.createResponse(`Deposited ${Math.min(depositCount, item.count)} ${item.name} into container`);
      } catch (e) {
        return factory.createErrorResponse(`Failed to deposit: ${(e as Error).message}`);
      }
    }
  );

  /**
   * Close the currently open container
   */
  factory.registerTool(
    "close-container",
    "Close the currently open container",
    {},
    async () => {
      if (!openContainer) {
        return factory.createErrorResponse("No container is currently open");
      }

      try {
        openContainer.close();
        openContainer = null;
        openContainerBlock = null;
        return factory.createResponse("Container closed");
      } catch (e) {
        return factory.createErrorResponse(`Failed to close container: ${(e as Error).message}`);
      }
    }
  );

  /**
   * Find nearby containers
   */
  factory.registerTool(
    "find-containers",
    "Find nearby containers (chests, furnaces, etc.)",
    {
      maxDistance: z.coerce.number().finite().optional().describe("Maximum search distance (default: 10)"),
    },
    async ({ maxDistance = 10 }) => {
      const bot = getBot();
      const containerTypes = ['chest', 'ender_chest', 'furnace', 'blast_furnace', 'smoker', 'barrel', 'hopper', 'dropper', 'dispenser'];

      const containers: { name: string; x: number; y: number; z: number; distance: number }[] = [];

      for (let x = -maxDistance; x <= maxDistance; x++) {
        for (let y = -maxDistance; y <= maxDistance; y++) {
          for (let z = -maxDistance; z <= maxDistance; z++) {
            const pos = bot.entity.position.offset(x, y, z);
            const block = bot.blockAt(pos);
            if (block && containerTypes.includes(block.name)) {
              const dist = Math.sqrt(x*x + y*y + z*z);
              containers.push({
                name: block.name,
                x: Math.floor(block.position.x),
                y: Math.floor(block.position.y),
                z: Math.floor(block.position.z),
                distance: Math.round(dist * 10) / 10
              });
            }
          }
        }
      }

      if (containers.length === 0) {
        return factory.createResponse(`No containers found within ${maxDistance} blocks`);
      }

      containers.sort((a, b) => a.distance - b.distance);

      let text = `Found ${containers.length} container(s):\n\n`;
      containers.slice(0, 10).forEach(c => {
        text += `  ${c.name} at (${c.x}, ${c.y}, ${c.z}) - ${c.distance} blocks away\n`;
      });

      return factory.createResponse(text);
    }
  );
}
