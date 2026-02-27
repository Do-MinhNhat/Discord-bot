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

export async function sendGeminiMessage(prompt, chatSession) {
    try {
        let result;
        //console.log("--- Dữ liệu gửi đi: ---"); console.log(prompt);

        result = await chatSession.sendMessage(
            `
## ROLE
Bạn là một trợ lý ảo trên Discord, có nhiệm vụ trả lời các câu hỏi và tương tác với người dùng dựa trên lịch sử trò chuyện (nếu có).

## TASK
- Trả lời câu hỏi của người dùng một cách chính xác và ngắn gọn.
- Sử dụng thông tin từ lịch sử trò chuyện để cung cấp ngữ cảnh nếu cần thiết.
- Nếu không có đủ thông tin, hãy yêu cầu thêm chi tiết.

## CONSTRAINTS
- Tránh sử dụng Emoji không cần thiết.
- <@...> và name là giống nhau, đều dùng để nhắc đến người dùng. Khuyên dùng <@...> để đảm bảo chính xác.
- Sẽ có nhiều người dùng tương tác, hãy đảm bảo phản hồi đúng người bằng cách sử dụng ID của họ.
- Nếu có nhiều câu hỏi được đưa ra, hãy trả lời tất cả trong 1 tin nhắn (có thể dùng xuống dòng).

## INPUT
- Cấu trúc: 
- Lịch sử trò chuyện được cung cấp dưới dạng JSON, bao gồm ID người gửi, tên người gửi và nội dung tin nhắn.
- Khi content chứa <@...>, đồng nghĩa với việc nhắc đến ai đó có id nằm bên trong "<@...>".
- id đã đưa ra câu hỏi hoặc yêu cầu là id cuối cùng.

## BONUS INSTRUCTION (Có thể không có)
- ${Instruction}

## OUTPUT FORMAT
Trả về kết quả dưới dạng JSON:
{
    "response": "...",
    "memory" : null
}

## DATA
${prompt}
            `
        );

        //console.log("--- PHẢN HỒI TỪ AI ---"); console.log(result.response.text());

        const extracted = extractJSON(result.response.text());
        if (!extracted) {
            throw new Error("Không thể trích xuất JSON từ phản hồi của Gemini.");
        }
        return extracted.response;
    } catch (error) {
        if (error.message.includes("quota") && index < maxIndex) {
            throw new Error("Đã hết hạn mức sử dụng cho model này, vui lòng chọn model khác hoặc thử lại sau.");
        }
        console.error("Lỗi Gemini API:", error);
        throw error;
    }
};
