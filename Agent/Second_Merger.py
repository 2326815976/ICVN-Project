import os
import glob
import json
import math
from openai import OpenAI

# ================= 配置读取 =================
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
    config = json.load(f)

DEEPSEEK_API_KEY = config["API"]["DEEPSEEK_API_KEY"]
BASE_URL = config["API"]["BASE_URL"]

INPUT_DIR = config["PATHS"]["STAGE2_INPUT_DIR"]
OUTPUT_DIR = config["PATHS"]["STAGE2_OUTPUT_DIR"]

os.makedirs(OUTPUT_DIR, exist_ok=True)

# 初始化 DeepSeek 客户端
client = OpenAI(
    api_key=DEEPSEEK_API_KEY,
    base_url=BASE_URL
)

# ================= 提示词区域 =================
SYSTEM_PROMPT = """你需要对多份口供的事件进行结构化整理，根据里面所提到的人物、事件信息完成人物信息抽取、人物统一（实体对齐）以及关系整理。
一、任务目标
1.将所有口供整理为案件事件三元组，进行跨事件人物合并，合并时需将“角色称呼”与后文具体姓名的参与人进行关联比对。若同一人既以角色称呼出现，又以具体姓名出现，则合并为同一人物，统一使用具体姓名（如无姓名则使用最明确称呼）；
2.若同一角色在不同口供中承担相同职能且行为链相同、作案工具相同（大致类似），也应合并；
3.可能出现在不同口供描述中的一个事件，事件三元组中一个描述为是人物A，一个描述为是人物B，这种情况也需要进行合并。
二、输出格式
必须严格按照以下JSON结构输出，不得添加任何额外说明或标记：
{
  "案件事件三元组": [
    {
      "人物A名称": "","人物A所扮演角色": "",
      "人物B名称": "","人物B所扮演角色": "",
      "行为序列": [
        "",
        "",
        ""
      ]
    }
  ]
}
"""


def call_llm_to_merge(content_list, merge_index):
    data_str = json.dumps(content_list, ensure_ascii=False, indent=2)
    user_content = f"{SYSTEM_PROMPT}\n具体口供内容为：\n{data_str}\n以上为全部内容。"

    # 【重要调整】恢复了强制输出合法 JSON 的系统提示词
    messages = [
        {"role": "system",
         "content": "你必须严格按照提供的 JSON 格式输出。如果数据量过大，你可以分批输出。每次输出都必须是一个包含 '案件事件三元组' 键的合法完整 JSON 对象。不要包含 markdown 代码块。"},
        {"role": "user", "content": user_content}
    ]

    all_merged_triples = []
    max_retries = 5
    full_result_str_log = ""  # 仅用于报错调试留存

    try:
        for attempt in range(max_retries):
            response = client.chat.completions.create(
                model="deepseek-chat",
                messages=messages,
                response_format={"type": "json_object"},  # 重新开启强约束，逼迫模型保证格式
                temperature=0.1,
                max_tokens=8192
            )

            result_chunk = response.choices[0].message.content
            finish_reason = response.choices[0].finish_reason
            full_result_str_log += result_chunk + "\n\n=== 截断分割线 ===\n\n"

            # 提取纯净文本
            clean_chunk = result_chunk.strip()
            if clean_chunk.startswith("```json"):
                clean_chunk = clean_chunk[7:]
            if clean_chunk.startswith("```"):
                clean_chunk = clean_chunk[3:]
            if clean_chunk.endswith("```"):
                clean_chunk = clean_chunk[:-3]
            clean_chunk = clean_chunk.strip()

            if finish_reason == "length":
                print(f"  [提示] {merge_index} 输出触达长度上限，执行【结构化断点保护】 (第 {attempt + 1} 次续写)...")

                # ==== 核心黑科技：大括号回溯强行闭合解析 ====
                valid_str = clean_chunk
                rescued = False
                while True:
                    last_brace_idx = valid_str.rfind('}')
                    if last_brace_idx == -1:
                        break  # 找不到括号了，放弃抢救这一块

                    test_str = valid_str[:last_brace_idx + 1]
                    # 强行给它补齐尾部的数组和对象闭合
                    if "案件事件三元组" in test_str:
                        test_str += "\n  ]\n}"

                    try:
                        parsed_json = json.loads(test_str)
                        triples = parsed_json.get("案件事件三元组", [])
                        all_merged_triples.extend(triples)
                        print(f"    -> 成功抢救并入库 {len(triples)} 条完整三元组。")
                        rescued = True
                        break  # 解析成功，跳出回溯
                    except json.JSONDecodeError:
                        # 解析失败说明这个 '}' 是在文本内部或者损坏的，丢弃最后一个 '}' 继续往前找
                        valid_str = valid_str[:last_brace_idx]

                if not rescued:
                    print("    -> [警告] 截断部分抢救失败，未找到完整的对象结构。")

                # 引导模型将剩下的内容放在一个全新的完整 JSON 中输出
                messages.append({"role": "assistant", "content": result_chunk})
                messages.append({
                    "role": "user",
                    "content": "你的输出由于长度限制被截断了。请**接着刚才输出的最后一个完整的三元组之后**，继续整理并输出剩余的部分。\n要求：必须输出一个全新的、格式合法的完整 JSON 对象：`{\"案件事件三元组\": [ ... ] }`。千万不要包含刚才已经输出过的三元组，直接输出下一条。"
                })
            else:
                # 正常结束，完整解析
                try:
                    parsed_json = json.loads(clean_chunk)
                    triples = parsed_json.get("案件事件三元组", [])
                    all_merged_triples.extend(triples)
                except json.JSONDecodeError as je:
                    print(f"  [错误] 正常结束时的 JSON 解析失败: {je}")
                    error_file = os.path.join(OUTPUT_DIR, f"error_json_{merge_index}.txt")
                    with open(error_file, "w", encoding="utf-8") as f:
                        f.write(full_result_str_log)
                break

        print(f"  [成功] {merge_index} 最终共完美提取 {len(all_merged_triples)} 条三元组。")
        return all_merged_triples

    except Exception as e:
        print(f"  [错误] 窗口合并过程发生意外错误 ({merge_index}): {e}")
        return []

def main():
    json_files = glob.glob(os.path.join(INPUT_DIR, "*.json"))
    if not json_files:
        print(f"在目录 {INPUT_DIR} 中没有找到任何 .json 文件，请检查第一阶段是否执行成功。")
        return

    print(f"共找到 {len(json_files)} 个 JSON 文件，准备读取数据...")

    all_extracted_triples = []
    for filepath in json_files:
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
                triples = data.get("案件事件三元组", [])
                if triples:
                    all_extracted_triples.append(triples)
        except Exception as e:
            print(f"读取文件 {filepath} 失败: {e}")

    if not all_extracted_triples:
        print("未能从文件中提取出任何 '案件事件三元组' 数据。")
        return

    print(f"成功提取 {len(all_extracted_triples)} 份口供的三元组数据，开始执行窗口合并策略...")

    current_layer_data = all_extracted_triples
    layer_num = 1

    while len(current_layer_data) > 1:
        print(f"\n--- 开始第 {layer_num} 层级合并，当前共有 {len(current_layer_data)} 份数据块 ---")
        next_layer_data = []
        window_size = 4

        num_batches = math.ceil(len(current_layer_data) / window_size)

        for i in range(num_batches):
            start_idx = i * window_size
            end_idx = start_idx + window_size
            chunk_to_merge = current_layer_data[start_idx:end_idx]

            print(f"  -> 正在合并第 {i + 1}/{num_batches} 批次 (包含 {len(chunk_to_merge)} 份数据)...")

            merged_result = call_llm_to_merge(chunk_to_merge, f"层级{layer_num}-批次{i + 1}")

            if merged_result:
                next_layer_data.append(merged_result)
            else:
                print(f"  [警告] 第 {i + 1} 批次合并失败，已跳过，可能会导致部分数据丢失。")

        current_layer_data = next_layer_data
        layer_num += 1

    print("\n================ 合并全部完成 ================")
    final_output = {
        "案件事件三元组": current_layer_data[0] if current_layer_data else []
    }

    final_filepath = os.path.join(OUTPUT_DIR, "Final_Global_Merged.json")
    with open(final_filepath, 'w', encoding='utf-8') as f:
        json.dump(final_output, f, ensure_ascii=False, indent=2)

    print(f"最终合并结果已保存至: {final_filepath}")

if __name__ == "__main__":
    main()