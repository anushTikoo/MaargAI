import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function test() {
    const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
            tools: [{
                functionDeclarations: [
                    {
                        name: "test_tool",
                        description: "Tests a tool",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                input: { type: "STRING" }
                            }
                        }
                    }
                ]
            }]
        }
    });

    try {
        console.log('Sending initial command...');
        const r1 = await chat.sendMessage({ message: 'Call test_tool with "hello"' });
        console.log('Function call: ', r1.functionCalls);

        console.log('Sending function response...');
        const r2 = await chat.sendMessage({
            message: [{
                functionResponse: {
                    name: 'test_tool',
                    response: { status: "ok" }
                }
            }]
        });
        console.log('Final text: ', r2.text);
    } catch(e) {
        console.error(e);
    }
}
test();
