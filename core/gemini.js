import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

let Instruction = null;

export function setInstruction(newInstruction) {
    Instruction = newInstruction;
}

const modelList = [
    "gemma-3n-e2b-it",
    "gemma-3n-e4b-it",
    "gemma-3-27b-it",
    "gemma-3-12b-it",
    "gemma-3-4b-it",
    "gemma-3-1b-it",
]

function extractJSON(str) {
    const jsonMatch = str.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.error("Lỗi khi phân tích JSON:", e);
            return null;
        }
    }
    return null;
}

export async function startGemini(instruction = "Không có", modelIndex = 0) {

    //console.log("Đang khởi tạo Gemini...");

    setInstruction(instruction);

    try {
        const model = genAI.getGenerativeModel({
            model: modelList[modelIndex],
        });

        //console.log("Gemini đã sẵn sàng!");

        return model.startChat();
    } catch (error) {
        console.error("Lỗi khi khởi động Gemini:", error);
        throw error;
    }
}

export async function sendGeminiMessage(prompt, context, chatSession) {
    try {
        let result;
        //console.log("--- Dữ liệu gửi đi: ---"); console.log(prompt);

        result = await chatSession.sendMessage(
            `
## ROLE
- Bạn là <@1471095365028548720> một discord bot, Bạn không phải là một AI của 1 người dùng mà là nhiều người dùng, bạn có thể trả lời câu hỏi, trò chuyện, giúp đỡ người dùng trong server Discord này.

## TASK
- Trả lời câu hỏi của người dùng một cách chính xác và ngắn gọn.
- Sử dụng thông tin từ lịch sử trò chuyện để cung cấp ngữ cảnh nếu cần thiết.
- Nếu không có đủ thông tin, hãy yêu cầu thêm chi tiết.

## CONSTRAINTS
- Tránh sử dụng Emoji không cần thiết.

## BONUS INSTRUCTION (Có thể không có)
- ${Instruction}

## OUTPUT FORMAT
Trả về kết quả dưới dạng JSON:
{
    "response": "...",
}

## CONTEXT
\`\`\`json
${JSON.stringify(context)}
\`\`\`

## INPUT
\`\`\`json
${JSON.stringify(prompt)}
\`\`\`
- Input có thể chứa ReferenceAuthor và RepliedContent. Đó là tin nhắn mà người dùng liên kết đến hãy đọc nó và trả lời câu hỏi của người dùng.
            `
        );
        console.log("--- CONTEXT ---"); console.log(context);
        console.log("--- PROMPT ---"); console.log(prompt);
        console.log("--- Dữ liệu nhận được từ Gemini ---"); console.log(result.response.text());

        //console.log("--- PHẢN HỒI TỪ AI ---"); console.log(result.response.text());

        const extracted = extractJSON(result.response.text());
        if (!extracted) {
            throw new Error("Không thể trích xuất JSON từ phản hồi của Gemini.");
        }
        return extracted.response;
    } catch (error) {
        if (error.message.includes("quota")) {
            throw new Error("Đã hết hạn mức sử dụng cho model này, vui lòng chọn model khác hoặc thử lại sau.");
        }
        console.error("Lỗi Gemini API:", error);
        throw error;
    }
};
