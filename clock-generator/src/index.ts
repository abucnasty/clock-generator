/**
 * Main entry point for clock-generator library.
 * Re-exports everything from the browser module for convenience, and in Node reads the game data from resources/.
 */

import './data/factorio-data-file';

export * from './browser';
