import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFile } from 'fs/promises';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const modelList = [
    "gemma-3n-e2b-it",
    "gemma-3n-e4b-it",
    "gemma-3-27b-it",
    "gemma-3-12b-it",
    "gemma-3-4b-it",
    "gemma-3-1b-it",
]

const index = 0;
const maxIndex = modelList.length - 1;

async function getSystemInstruction() {
    const filePath = await readFile(new URL('../nhancach.txt', import.meta.url), 'utf8');
    return filePath;
}

export async function sendGeminiMessage(prompt, chatHistory = []) {
    try {
        const model = genAI.getGenerativeModel({
            model: modelList[index],
        });

        const instruction = await getSystemInstruction();

        chatHistory.unshift(
            { role: "user", parts: [{ text: instruction }] },
            { role: "model", parts: [{ text: "Hệ thống được thiết lập hoàn tất xin mời tiếp tục." }] }
        );

        let result;

        console.log("--- Lịch sử trò truyện ---");
        console.dir(chatHistory, { depth: null });
        console.log("----------------------------");
        console.log("--- Dữ liệu gửi đi: ---");
        console.log(prompt);

        // User history: use startChat with history
        const chatSession = model.startChat({
            history: chatHistory,
        });
        result = await chatSession.sendMessage(prompt);

        console.log("--- PHẢN HỒI TỪ AI ---");
        console.log(result.response.text());

        return result.response.text();
    } catch (error) {
        if (error.message.includes("quota") && index < maxIndex) {
            index += 1;
            console.log(`Chuyển sang model kế tiếp: ${modelList[index]}`);
            return await sendGeminiMessage(prompt, chatHistory);
        }
        console.error("Lỗi Gemini API:", error);
        throw error;
    }
};