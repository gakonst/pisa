import { IAppointment, IEthereumAppointment } from "./dataEntities";
import { AppointmentSubscriber } from "./watcher/appointmentSubscriber";
import { EventObserver } from "./watcher/eventObserver";

enum CommandType {
    AddAppointment = 1
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
        public readonly blockHash,
        public readonly type: CommandType
    ) {}

    public abstract execute(): void;
}

export class AddAppointmentCommand extends Command {
    constructor(
        blockNumber: number,
        blockHash: string,
        private readonly appointment: IEthereumAppointment,
        private readonly appointmentSubscriber: AppointmentSubscriber,
        private readonly eventObserver: EventObserver

    ) {
        super(appointment.id, blockNumber, blockHash, CommandType.AddAppointment);
    }

    public execute(): void {
        // remove the subscription, this is blocking code so we don't have to worry that an event will be observed
        // whilst we remove these listeners and add new ones
        const filter = this.appointment.getEventFilter();
        this.appointmentSubscriber.unsubscribeAll(filter);

        // subscribe the listener
        const listener = async (...args: any[]) => await this.eventObserver.observe(this.appointment, args);
        this.appointmentSubscriber.subscribeOnce(this.appointment.id, filter, listener);
    }
}

abstract class UndoableCommand extends Command {
    public abstract undo(): void;
}

export class ExecutionEngine {
    constructor(private readonly store: CommandStore) {}

    public execute(command: Command) {
        this.store.add(command);
        command.execute();

        //TODO:113: errors?
    }

    public rollback(commands: UndoableCommand[]) {
        commands.forEach(c => {
            c.undo();
            this.store.remove(c);
        });

        //TODO:113: errors?
    }
}
