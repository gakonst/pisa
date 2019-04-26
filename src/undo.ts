import { IEthereumAppointment } from "./dataEntities";
import { EthereumResponderManager } from "./responder";
import { ethers } from "ethers";
import { Watcher } from "./watcher";
import { EventObserver } from "./watcher/eventObserver";

export enum CommandType {
    ObservedEvent = "observed",
    Responded = "responded"
}

export class ActionStore {
    private commandsById: {
        [id: string]: Command;
    } = {};

    add(command: Command) {
        this.commandsById[command.id] = command;
    }
    remove(command: Command) {
        delete this.commandsById[command.id];
    }
}

export abstract class Command {
    constructor(
        public readonly id: string,
        public readonly blockNumber: number,
        public readonly blockHash: string,
        public readonly type: CommandType
    ) {}

    public abstract execute(): Promise<void>;
}

export abstract class RollbackCommand extends Command {
    public abstract undo(): Promise<void>;
}

export class RollbackAction {
    constructor(
        public readonly blockNumber: number,
        public readonly blockHash: string,
        public readonly type: CommandType
    ) {}
}

export class ObservedEventAction extends RollbackAction {
    constructor(public readonly event: ethers.Event, public readonly appointment: IEthereumAppointment) {
        super(event.blockNumber, event.blockHash, CommandType.ObservedEvent);
    }
}

//TODO:113: consolidate the stores
export class ObservedEventCommand extends RollbackCommand {
    constructor(
        private readonly action: ObservedEventAction,
        private readonly eventObserver: EventObserver,
        private readonly watcher: Watcher
    ) {
        super(action.appointment.id, action.blockNumber, action.blockHash, CommandType.ObservedEvent);
    }

    /**
     * Calls the responder and removes the appointment from the store
     * @param appointment
     * @param eventArgs
     */
    public async execute() {
        await this.eventObserver.observe(this.action.appointment, this.action.event);
    }

    // TODO:113: not so sure about this, we need a cleaner way - maybe not direct
    // TODO:113: access to other commands, perhaps use saga?

    public async undo() {
        // TODO:113:
        // we could be currently in the process of responding
        // - we need to stop that!
        await this.watcher.addAppointment(this.action.appointment);
    }
}

export class RespondedAction extends RollbackAction {
    constructor(public readonly appointment: IEthereumAppointment, blockNumber: number, blockHash: string) {
        super(blockNumber, blockHash, CommandType.Responded);
    }
}

export class RespondedCommand extends RollbackCommand {
    constructor(private readonly action: RespondedAction, private readonly responder: EthereumResponderManager) {
        super(action.appointment.id, action.blockNumber, action.blockHash, CommandType.Responded);
    }

    public async execute() {
        // when we've finished responding we dont need to execute anything
    }

    public async undo() {
        // trigger a respond again
        await this.responder.respond(this.action.appointment);
    }
}
// TODO:113: docs, tests, reorganisation in this whole file - even rename it
