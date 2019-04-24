import { ethers } from "ethers";

abstract class BlockCommand {
    blockNumber: number;
    execute: () => {}
    undo: () => {}
}

class ReorgManager {
    constructor(private store: CommandStore, private undoManager: UndoManager, private readonly provider: ethers.providers.BaseProvider) {

    }

    execute(command: BlockCommand) {
        this.undoManager.addCommand(command);
    }

    rollBackTo(blockNumber: number) {
        const commands = this.store.getCommandsSinceBlock(blockNumber);
        this.undoManager.undoCommmands(commands)

        // reset the provider
        this.provider.resetEventsBlock(blockNumber);
    }
}

class CommandStore {
    add(command: BlockCommand) {}
    remove(command: BlockCommand) {}
    getCommandsSinceBlock(block: number): BlockCommand[] {
        return []
    }
}


class UndoManager {
    constructor(private store: CommandStore) {}

    addCommand(command: BlockCommand) {
        command.execute()
        this.store.add(command)
    }

    undoCommand(command: BlockCommand){
        command.undo()
        this.store.remove(command)
    }

    undoCommmands(commands: BlockCommand[]){
        commands.forEach(c => this.undoCommand(c));
    }
}