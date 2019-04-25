import { IEthereumAppointment } from "./dataEntities";
import { AppointmentSubscriber } from "./watcher/appointmentSubscriber";
import { EventObserver } from "./watcher/eventObserver";
import logger from "./logger";
import { EthereumResponderManager } from "./responder";
import { IAppointmentStore } from "./watcher/store";
import { inspect } from "util";
import { ethers } from "ethers";

enum CommandType {
    AddAppointment = 1,
    ObservedEvent = 2
}

export class CommandStore {
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

abstract class Command {
    constructor(
        public readonly id: string,
        public readonly blockNumber: number,
        public readonly blockHash: string,
        public readonly type: CommandType
    ) {}

    public abstract execute(): Promise<void>;
}

abstract class RollbackCommand extends Command {
    public abstract undo(): Promise<void>;
}

class Action {
    constructor(
        public readonly blockNumber: number,
        public readonly blockHash: string,
        public readonly type: CommandType
    ) {}
}

export class AppointmentAction extends Action {
    constructor(blockNumber: number, blockHash: string, public readonly appointment: IEthereumAppointment) {
        super(blockNumber, blockHash, CommandType.AddAppointment);
    }
}

// TODO:113: horrible to have so many dependencies - does it make sense?
export class AddAppointmentCommand extends Command {
    constructor(
        private readonly addAppoitmentAction: AppointmentAction,
        private readonly appointmentSubscriber: AppointmentSubscriber,
        private readonly actionManager: ActionManager
    ) {
        super(
            addAppoitmentAction.appointment.id,
            addAppoitmentAction.blockNumber,
            addAppoitmentAction.blockHash,
            CommandType.AddAppointment
        );
    }

    public async execute(): Promise<void> {
        // remove the subscription, this is blocking code so we don't have to worry that an event will be observed
        // whilst we remove these listeners and add new ones
        const filter = this.addAppoitmentAction.appointment.getEventFilter();
        this.appointmentSubscriber.unsubscribeAll(filter);

        // subscribe the listener
        const eventObserver = async (event: ethers.Event) => {
            const observeEventAction = new ObservedEventAction(event, this.addAppoitmentAction.appointment);
            this.actionManager.add(observeEventAction);
        };

        this.appointmentSubscriber.subscribeOnce(this.addAppoitmentAction.appointment.id, filter, eventObserver);
    }
}

export class ActionManager {
    constructor(
        private readonly executionEngine: ExecutionEngine,
        private readonly appointmentSubscriber: AppointmentSubscriber,
        private readonly responder: EthereumResponderManager,
        private readonly store: IAppointmentStore
    ) {}

    // if a command is provider, we execute it with the execution manager
    // then we decide what the next relevant command is

    async add(action: Action) {
        // execute the command
        //await this.executionEngine.execute(command);

        // now find the next command
        if (action.type === CommandType.AddAppointment) {
            // create a new action command
            // TODO:113: avoid cast
            const addAppointmentCommand = new AddAppointmentCommand(
                action as AppointmentAction,
                this.appointmentSubscriber,
                this
            );
            this.executionEngine.execute(addAppointmentCommand);
        } else if (action.type === CommandType.ObservedEvent) {
            const observeEventCommand = new ObservedEventCommand(
                action as ObservedEventAction,
                this.responder,
                this.store,
                this
            );
            this.executionEngine.execute(observeEventCommand);
        }
    }
}

class ObservedEventAction extends Action {
    constructor(public readonly event: ethers.Event, public readonly appointment: IEthereumAppointment) {
        super(event.blockNumber, event.blockHash, CommandType.ObservedEvent);
    }
}

//TODO:113: consolidate the stores
export class ObservedEventCommand extends RollbackCommand {
    constructor(
        private readonly action: ObservedEventAction,
        private readonly responder: EthereumResponderManager,
        private readonly store: IAppointmentStore,
        private readonly actionManager: ActionManager
    ) {
        super(action.appointment.id, action.blockNumber, action.blockHash, CommandType.ObservedEvent);
    }

    /**
     * Calls the responder and removes the appointment from the store
     * @param appointment
     * @param eventArgs
     */
    public async execute() {
        return await this.withLogAndCatch(this.action.appointment, this.action.event, async () => {
            // pass the appointment to the responder to complete. At this point the job has completed as far as
            // the watcher is concerned, therefore although respond is an async function we do not need to await it for a result
            this.responder.respond(this.action.appointment);

            // after firing a response we can remove the local store
            await this.store.removeById(this.action.appointment.id);
        });
    }

    // TODO:113: not so sure about this, we need a cleaner way - maybe not direct
    // TODO:113: access to other commands, perhaps use saga?

    public async undo() {
        // update this appointment in the store
        const updated = await this.store.addOrUpdateByStateLocator(this.action.appointment);
        // only if we acually updated the store do we need to anything
        if (updated) {
            // current block + hash
            const action = new AppointmentAction(
                this.action.blockNumber,
                this.action.blockHash,
                this.action.appointment
            );
            this.actionManager.add(action);
        }
    }

    /** A helper method for wrapping a block in a catch, and logging relevant info */
    private async withLogAndCatch(
        appointment: IEthereumAppointment,
        event: ethers.Event,
        observeEvent: (appointment: IEthereumAppointment, event: ethers.Event) => Promise<void>
    ) {
        // this callback should not throw exceptions as they cannot be handled elsewhere
        try {
            logger.info(
                appointment.formatLog(
                    `Observed event ${appointment.getEventName()} in contract ${appointment.getContractAddress()}.`
                )
            );
            logger.debug(`Event info: ${inspect(event)}`);

            await observeEvent(appointment, event);
        } catch (doh) {
            // an error occured whilst responding to the callback - this is serious and the problem needs to be correctly diagnosed
            logger.error(
                appointment.formatLog(
                    `An unexpected errror occured whilst responding to event ${appointment.getEventName()} in contract ${appointment.getContractAddress()}.`
                )
            );
            logger.error(appointment.formatLog(doh));
        }
    }
}

export class ExecutionEngine {
    constructor(private readonly store: CommandStore) {}

    public async execute(command: Command) {
        this.store.add(command);
        return await command.execute();

        //TODO:113: errors?
    }

    public rollback(commands: RollbackCommand[]) {
        commands.forEach(c => {
            c.undo();
            this.store.remove(c);
        });

        //TODO:113: errors?
    }
}

// TODO:113: docs, tests, reorganisation in this whole file - even rename it
