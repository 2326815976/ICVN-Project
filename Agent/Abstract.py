import os
import json
from openai import OpenAI

# ================= 配置读取 =================
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
    config = json.load(f)

DEEPSEEK_API_KEY = config["API"]["DEEPSEEK_API_KEY"]
BASE_URL = config["API"]["BASE_URL"]

INPUT_JSON_FILE = config["PATHS"]["STAGE4_INPUT_FILE"]
OUTPUT_JSON_FILE = config["PATHS"]["STAGE4_OUTPUT_FILE"]

# 初始化 DeepSeek 客户端
client = OpenAI(
    api_key=DEEPSEEK_API_KEY,
    base_url=BASE_URL
)

def summarize_behavior_sequence(sequence_list):
    if not sequence_list:
        return ""

    sequence_text = "\n".join([f"{i + 1}. {act}" for i, act in enumerate(sequence_list)])

    system_prompt = "你是一个专业的案情总结助手。你的任务是将一段详细的行为序列浓缩成一段高度精炼的简介。严格遵守：字数在50字以内，直接输出简介文本，不要任何多余的解释、标点或Markdown格式。"
    user_prompt = f"请将以下行为序列浓缩为50字以内的简介：\n{sequence_text}"

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.1
        )

        summary = response.choices[0].message.content.strip()
        return summary

    except Exception as e:
        print(f"API 请求发生错误: {e}")
        return "总结生成失败"

def main():
    if not os.path.exists(INPUT_JSON_FILE):
        print(f"错误: 未找到输入文件 {INPUT_JSON_FILE}")
        return

    try:
        with open(INPUT_JSON_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"读取或解析文件时发生错误: {e}")
        return

    triplets = data.get("案件事件三元组", [])
    if not triplets:
        print("警告: JSON 文件中未找到 '案件事件三元组' 字段或该列表为空。")
        return

    print(f"共发现 {len(triplets)} 个事件三元组，开始进行浓缩处理...")

    for index, item in enumerate(triplets):
        print(f"正在处理第 {index + 1} 个事件的简介...")
        behavior_sequence = item.get("行为序列", [])
        summary_text = summarize_behavior_sequence(behavior_sequence)
        item["简介"] = summary_text
        #print(f"完成第 {index + 1} 个事件 -> 简介: {summary_text}")

    output_dir = os.path.dirname(OUTPUT_JSON_FILE)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    try:
        with open(OUTPUT_JSON_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"\n所有处理已完成！结果已成功保存至: {OUTPUT_JSON_FILE}")
    except Exception as e:
        print(f"保存结果文件时发生错误: {e}")

if __name__ == "__main__":
    main()