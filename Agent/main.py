import subprocess
import sys
import os
import json
import glob
from datetime import datetime

# ================= 阶段一：子脚本执行配置 =================
FILE_1 = r"D:\DeepLeaning\Pyprojects\PyBullet\Interrogation_Project\Agent\First_Extraction.py"
FILE_2 = r"D:\DeepLeaning\Pyprojects\PyBullet\Interrogation_Project\Agent\Second_Merger.py"
FILE_3 = r"D:\DeepLeaning\Pyprojects\PyBullet\Interrogation_Project\Agent\Logical_Judgment.py"
FILE_4 = r"D:\DeepLeaning\Pyprojects\PyBullet\Interrogation_Project\Agent\Abstract.py"

# 将要执行的文件放入列表中，按顺序排列
scripts_to_run = [FILE_1, FILE_2, FILE_3, FILE_4]


def execute_scripts_sequentially(scripts):
    """按顺序执行给定的 Python 脚本列表，返回 True 表示全部成功，False 表示中途失败"""
    for index, script in enumerate(scripts, start=1):
        print(f"\n[{index}/{len(scripts)}] ========================================")
        print(f"▶ 准备执行: {script}")

        # 检查文件是否真的存在，防止因为写错路径导致报错
        if not os.path.exists(script):
            print(f"❌ 错误: 找不到文件 '{script}'。")
            print("🛑 停止执行后续脚本。")
            return False  # 使用 return 替代 break，方便主程序判断结果

        try:
            # sys.executable 指代当前正在运行的 python 解释器路径
            # check=True 表示如果子脚本报错返回非 0 状态码，则抛出异常
            subprocess.run([sys.executable, script], check=True)
            print(f"✅ {script} 执行成功！")

        except subprocess.CalledProcessError as e:
            print(f"❌ 错误: 脚本 '{script}' 执行失败，返回码: {e.returncode}")
            print("🛑 为保证流程安全，已停止执行后续脚本。")
            return False
        except Exception as e:
            print(f"❌ 发生未知错误: {e}")
            return False

    return True


# ================= 阶段二：数据合并功能配置 =================
# PERSON_DIR_PATH: 存放多个【被审讯人】JSON文件的文件夹路径
PERSON_DIR_PATH = r"D:\DeepLeaning\Pyprojects\PyBullet\Interrogation_Project\Agent\First_Extraction_Out"
# EVENTS_FILE_PATH: 包含【案件事件三元组】信息（且已补充了"简介"字段）的单一JSON文件路径
EVENTS_FILE_PATH = r"D:\DeepLeaning\Pyprojects\PyBullet\Interrogation_Project\Agent\Last_Out\Last_output.json"
# OUTPUT_PATH: 整合后输出的新JSON文件路径
OUTPUT_PATH = r"D:\DeepLeaning\Pyprojects\PyBullet\Interrogation_Project\Agent\merged_result.json"


def process_interrogation_directory(person_dir_path, events_file_path, output_path=None):
    """读取目标目录和事件文件，生成整合后的 JSON"""
    interrogated_person = []
    interrogated_names = set()

    # 1. 遍历并读取目录下的所有【被审讯人】JSON文件
    search_pattern = os.path.join(person_dir_path, '*.json')
    person_files = glob.glob(search_pattern)

    if not person_files:
        print(f"⚠️ 在目录 {person_dir_path} 中没有找到任何 .json 文件。")

    for idx, file_path in enumerate(person_files):
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            person_info = data.get("被审讯人", {})
            name = person_info.get("姓名", "")

            # 将名字加入集合，用于后续过滤事件人物
            if name:
                interrogated_names.add(name)

            interrogated_person.append({
                "id": f"{idx + 1}",  # 自动递增生成 person_1, person_2...
                "name": name,
                "sex": person_info.get("性别", ""),
                "birthday": person_info.get("出生日期", ""),
                "IDnumber": person_info.get("身份证号", ""),
                "regPlace": person_info.get("户籍地", ""),
                "nowPlace": person_info.get("现住址", ""),
                "occupation": person_info.get("职业/社会身份", ""),
                "family": person_info.get("家庭成员", ""),
                "criminal": person_info.get("既往违法犯罪记录", ""),
                "remark": person_info.get("其他补充", "")
            })
        except json.JSONDecodeError as e:
            print(f"❌ 解析 {file_path} 失败，跳过该文件。错误信息: {e}")
        except Exception as e:
            print(f"❌ 读取 {file_path} 时发生未知错误，跳过该文件。错误信息: {e}")

    # 2. 读取【案件事件】JSON数据
    with open(events_file_path, 'r', encoding='utf-8') as f2:
        data2 = json.load(f2)

    # 3. 提取【事件】与所有【事件相关人物】
    events = []
    all_event_names = set()
    triplets = data2.get("案件事件三元组", [])

    for idx, triplet in enumerate(triplets):
        name1 = triplet.get("人物A名称", "")
        name2 = triplet.get("人物B名称", "")

        # 将名字加入事件人物总集合
        if name1: all_event_names.add(name1)
        if name2: all_event_names.add(name2)

        # 将行为序列用换行符拼接作为事件详细描述
        actions = triplet.get("行为序列", [])
        event_desc = "\n".join(actions)

        # 提取简介字段
        event_summary = triplet.get("简介", f"关于 {name1} 与 {name2} 的交互事件")

        events.append({
            "eventID": f"{idx + 1}",
            "name1": name1,
            "name2": name2,
            "eventDescription": event_desc,
            "eventOverview": event_summary
        })

    # 4. 筛选出【仅在事件中出现，不在被审讯人中出现】的人物
    event_person_names = all_event_names - interrogated_names
    event_person = [{"name": name} for name in event_person_names]

    # 5. 生成当前的时间戳 (ISO 8601格式)
    current_time = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')

    # 6. 组装最终的目标JSON
    result_json = {
        "success": True,
        "data": {
            "projectId": "我这边不提供这个，需要数据库去进行累计判断",
            "type": "merge",
            "result": {
                "meta": {
                    "provider": "default",
                    "model": "deepseek"
                },
                "interrogatedPerson": interrogated_person,
                "eventPerson": event_person,
                "events": events
            },
            "errorMessage": "",
            "createdAt": current_time,
            "updatedAt": current_time
        },
        "meta": {
            "requestId": "req_AI",
            "timestamp": current_time
        }
    }

    # 7. 写入文件
    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f_out:
            json.dump(result_json, f_out, ensure_ascii=False, indent=2)
        print(f"✅ 合并完成！共读取了 {len(interrogated_person)} 个被审讯人文件。")
        print(f"✅ 结果已保存至：{output_path}")

    return json.dumps(result_json, ensure_ascii=False, indent=2)


# ================= 主程序执行入口 =================
if __name__ == "__main__":
    print("🚀 开始阶段一：按顺序执行前置脚本任务...")
    # 执行脚本，并获取执行是否全部成功的结果
    scripts_success = execute_scripts_sequentially(scripts_to_run)

    # 只有前置脚本全部成功，才继续进行数据合并
    if scripts_success:
        print("\n🎉 阶段一完成！")
        print("🚀 开始阶段二：执行数据提取与合并任务...")
        try:
            final_json_str = process_interrogation_directory(PERSON_DIR_PATH, EVENTS_FILE_PATH, OUTPUT_PATH)
            print("\n🎊 全部任务圆满完成！")
        except FileNotFoundError as e:
            print(f"❌ 找不到文件或目录，请检查路径是否正确: {e}")
        except Exception as e:
            print(f"❌ 运行合并数据过程中发生错误: {e}")
    else:
        print("\n⚠️ 前置脚本执行失败，为保证数据正确，已取消阶段二的数据合并操作。")