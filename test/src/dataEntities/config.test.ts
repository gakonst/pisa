import "mocha";
import { expect } from "chai";
import { IArgConfig, ConfigManager } from "../../../src/dataEntities/config";

describe("ConfigManager", () => {
    it("parses and serialises command line args", () => {
        const config: IArgConfig = {
            dbDir: "pisa-db",
            hostName: "0.0.0.0",
            hostPort: 4567,
            jsonRpcUrl: "http://localhost:8545",
            loglevel: "info",
            responderKey: "0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c",
            receiptKey: "0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c"
        };

        const manager = new ConfigManager(ConfigManager.PisaConfigProperties);
        const args = manager.toCommandLineArgs(config);
        const parsedConfig = manager.fromCommandLineArgs(args);
        Object.keys(config).forEach(key => {
            expect((parsedConfig as any)[key]).to.equal((config as any)[key]);
        });
    });
});
