import { loadConfigFromFile } from './config/loader';
import { ConfigPaths } from './config/config-paths';
import { DebugSettingsProvider } from './crafting/sequence/debug/debug-settings-provider';
import { generateClockForConfig, GenerateClockOptions } from './crafting/generate-blueprint';
import { encodeBlueprintFile } from "./blueprints/serde";
import { Config } from './config/schema';
import { RunnerStepType } from './crafting/runner';
import fs from 'fs/promises'


async function main() {
    // Accept config path from command line argument, default to PRODUCTION_SCIENCE_SHARED_JSON
    const configArg = process.argv.find(arg => arg.startsWith('--config='));
    const configPath = configArg 
        ? configArg.split('=')[1] 
        : ConfigPaths.PROCESSING_UNITS;
    
    const config: Config = await loadConfigFromFile(configPath);
    
    console.log("Loaded config:");
    console.log("----------------------");
    console.log(JSON.stringify(config, null, 2));
    console.log("----------------------");

    const debug = DebugSettingsProvider.mutable();
    debug.setSettings({
        plugin_settings: {
            craft_event: {
                print_bonus_progress: false,
                print_craft_progress: false,
            }
        }
    })
    const options: GenerateClockOptions = {
        // Define which steps to enable debug logging for
        debug_steps: {
            [RunnerStepType.PREPARE]: false,
            [RunnerStepType.WARM_UP]: false,
            [RunnerStepType.SIMULATE]: false
        },
        debug: debug
    };

    const result = generateClockForConfig(config, options);

    console.log("\n----------------------");
    console.log("Blueprint string:");
    console.log(encodeBlueprintFile({
        blueprint: result.blueprint
    }));
}

main().catch(console.error);