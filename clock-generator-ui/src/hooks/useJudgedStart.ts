import { createContext, useContext } from 'react';
import { DEFAULT_JUDGED_START, type JudgedStart } from '../utils/judgedStart';

/** The start the shown clocks were judged from; the results workspace provides it from the config they were made for */
export const JudgedStartContext = createContext<JudgedStart>(DEFAULT_JUDGED_START);

export const useJudgedStart = (): JudgedStart => useContext(JudgedStartContext);
