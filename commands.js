import 'dotenv/config';
import { InstallGlobalCommands } from './utils.js';

// Delete bot message command
const DELETE_COMMAND = {
    name: 'delete',
    description: 'Duyệt qua tin nhắn của bot và xóa chúng',
    options: [
        {
            type: 4,
            name: 'number',
            description: 'Nhập số lượng tin nhắn cần duyệt qua (tối đa 100)',
            required: true,
            min_value: 1,
            max_value: 100,
        },
    ],
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 2],
};

const START_GEMINI_COMMAND = {
    name: 'start',
    description: 'Khởi động hệ thống Chat Bot',
    options: [
        {
            type: 3,
            name: 'instruction',
            description: 'Nhập hướng dẫn hoặc nhân cách (Không chọn = mặc định)',
        },
        {
            type: 4,
            name: 'model',
            description: 'Chọn model (Không chọn = mặc định)',
            choices: [
                { name: 'gemma-3n-e2b-it (Mặc định và khuyên dùng)', value: 0 },
                { name: 'gemma-3n-e4b-it', value: 1 },
                { name: 'gemma-3-27b-it', value: 2 },
                { name: 'gemma-3-12b-it', value: 3 },
                { name: 'gemma-3-4b-it', value: 4 },
                { name: 'gemma-3-1b-it', value: 5 },
            ],
        },
    ],
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 2],
};

const STOP_GEMINI_COMMAND = {
    name: 'stop',
    description: 'Dừng hệ thống Chat Bot',
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 2],
};

const ALL_COMMANDS = [DELETE_COMMAND, START_GEMINI_COMMAND, STOP_GEMINI_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
