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
        },
    ],
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 2],
};

const ALL_COMMANDS = [DELETE_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
