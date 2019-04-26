import {
    RollbackAction,
    ObservedEventAction,
    ObservedEventCommand,
    CommandType,
    RespondedCommand,
    RespondedAction,
    ActionStore,
    RollbackCommand
} from "../undo";
import { EthereumResponderManager } from "../responder";
import { Watcher } from "../watcher";
import { EventObserver } from "../watcher/eventObserver";

export class ActionManager {
    private constructor(
        private readonly actionStore: ActionStore,
        private readonly responder: EthereumResponderManager,
        private readonly eventObserver: EventObserver,
        private readonly watcher: Watcher
    ) {}

    public static initialise(
        actionStore: ActionStore,
        responder: EthereumResponderManager,
        eventObserver: EventObserver,
        watcher: Watcher
    ) {
        ActionManager.mTheActionManger = new ActionManager(
            actionStore,
            responder,
            eventObserver,
            watcher
        );
    }

    private static mTheActionManger: ActionManager;
    public static get theActionManager() {
        return ActionManager.mTheActionManger;
    }

    // if a command is provider, we execute it with the execution manager
    // then we decide what the next relevant command is

    public async add(action: RollbackAction) {
        const command = this.commandFromAction(action);
        this.actionStore.add(command);
        await command.execute();

        // TODO:113: errors?
    }

    private commandFromAction(action: RollbackAction): RollbackCommand {
        if (action.type === CommandType.ObservedEvent) {
            // TODO:113: avoid cast
            return new ObservedEventCommand(action as ObservedEventAction, this.eventObserver, this.watcher);
        } else if (action.type === CommandType.Responded) {
            return new RespondedCommand(action as RespondedAction, this.responder);
        }

        // TODO:113: otherwise throw an error
    }

    public async rollback(actions: RollbackAction[]) {
        await Promise.all(
            actions
                .map(a => this.commandFromAction(a))
                .map(async c => {
                    await c.undo();
                    this.actionStore.remove(c);
                })
        );

        //TODO:113: errors?
    }
}
