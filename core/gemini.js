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

async function getSystemInstruction() {
    const filePath = await readFile(new URL('../nhancach.txt', import.meta.url), 'utf8');
    return filePath;
}

export async function startGemini(instruction = null, modelIndex = 0) {
    const systemInstruction = await getSystemInstruction();

    console.log("Đang khởi tạo Gemini...");

    try {
    const model = genAI.getGenerativeModel({
        model: modelList[modelIndex],
    });

    return model.startChat({
        history: [
            { role: "user", parts: [{ text: systemInstruction + (instruction ? "\n**Các Yêu cầu hệ thống khác**: " + instruction : "") }] },
            { role: "model", parts: [{ text: "Hệ thống được thiết lập hoàn tất xin mời tiếp tục." }] }
        ]
    });
    } catch (error) {
        console.error("Lỗi khi khởi động Gemini:", error);
        throw error;
    }
}

export async function sendGeminiMessage(prompt, chatSession) {
    try {
        let result;
        console.log("--- Dữ liệu gửi đi: ---");
        console.log(prompt);

        result = await chatSession.sendMessage(prompt);

        console.log("--- PHẢN HỒI TỪ AI ---");
        console.log(result.response.text());

        return result.response.text();
    } catch (error) {
        if (error.message.includes("quota") && index < maxIndex) {
            throw new Error("Đã hết hạn mức sử dụng cho model này, vui lòng chọn model khác hoặc thử lại sau.");
        }
        console.error("Lỗi Gemini API:", error);
        throw error;
    }
};
