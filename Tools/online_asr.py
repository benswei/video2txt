import logging
import sys
import time
import hashlib
from os import PathLike
from pathlib import Path
from typing import Literal, Optional
from enum import Enum
import requests
from pydantic import BaseModel

# 配置日志
logging.basicConfig(
    format="%(asctime)s - [%(levelname)s] %(message)s", level=logging.INFO
)

API_BASE_URL = "https://member.bilibili.com/x/bcut/rubick-interface"
API_REQ_UPLOAD = API_BASE_URL + "/resource/create"
API_COMMIT_UPLOAD = API_BASE_URL + "/resource/create/complete"
API_CREATE_TASK = API_BASE_URL + "/task"
API_QUERY_RESULT = API_BASE_URL + "/task/result"

SUPPORT_SOUND_FORMAT = Literal["flac", "aac", "m4a", "mp3", "wav"]
INFILE_FMT = ["flac", "aac", "m4a", "mp3", "wav"]
OUTFILE_FMT = ["srt", "json", "lrc", "txt"]

# ─── Pydantic 数据模型 ────────────────────────────────────────

class ASRDataSeg(BaseModel):
    """文字识别-断句"""
    class ASRDataWords(BaseModel):
        """文字识别-逐字"""
        label: str
        start_time: int
        end_time: int

    start_time: int
    end_time: int
    transcript: str
    words: list[ASRDataWords]

    def to_srt_ts(self) -> str:
        """转换为srt时间戳"""
        def _conv(ms: int) -> tuple[int, int, int, int]:
            return ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000

        s_h, s_m, s_s, s_ms = _conv(self.start_time)
        e_h, e_m, e_s, e_ms = _conv(self.end_time)
        return f"{s_h:02d}:{s_m:02d}:{s_s:02d},{s_ms:03d} --> {e_h:02d}:{e_m:02d}:{e_s:02d},{e_ms:03d}"

    def to_lrc_ts(self) -> str:
        """转换为lrc时间戳"""
        def _conv(ms: int) -> tuple[int, int, int]:
            return ms // 60000, ms // 1000 % 60, ms % 1000 // 10

        s_m, s_s, s_ms = _conv(self.start_time)
        return f"[{s_m:02d}:{s_s:02d}.{s_ms:02d}]"


class ASRData(BaseModel):
    """语音识别结果"""
    utterances: list[ASRDataSeg]
    version: str

    def __iter__(self):
        return iter(self.utterances)

    def has_data(self) -> bool:
        """是否识别到数据"""
        return len(self.utterances) > 0

    def to_txt(self) -> str:
        """转成 txt 格式字幕 (无时间标记)"""
        return "\n".join(seg.transcript for seg in self.utterances)

    def to_srt(self) -> str:
        """转成 srt 格式字幕"""
        return "\n".join(
            f"{n}\n{seg.to_srt_ts()}\n{seg.transcript}\n"
            for n, seg in enumerate(self.utterances, 1)
        )

    def to_lrc(self) -> str:
        """转成 lrc 格式字幕"""
        return "\n".join(
            f"{seg.to_lrc_ts()}{seg.transcript}" for seg in self.utterances
        )


class ResourceCreateRspSchema(BaseModel):
    """上传申请响应"""
    resource_id: str
    title: str
    type: int
    in_boss_key: str
    size: int
    upload_urls: list[str]
    upload_id: str
    per_size: int


class ResourceCompleteRspSchema(BaseModel):
    """上传提交响应"""
    resource_id: str
    download_url: str


class TaskCreateRspSchema(BaseModel):
    """任务创建响应"""
    resource: str
    result: Optional[str] = None
    task_id: str


class ResultStateEnum(Enum):
    """任务状态枚举"""
    STOP = 0      # 未开始
    RUNING = 1    # 运行中
    ERROR = 3     # 错误
    COMPLETE = 4  # 完成


class ResultRspSchema(BaseModel):
    """任务结果查询响应"""
    task_id: str
    result: Optional[str] = None  # 允许为 None，以防接口未完成时不返回 result
    remark: str
    state: ResultStateEnum

    def parse(self) -> ASRData:
        """解析结果数据"""
        if not self.result:
            return ASRData(utterances=[], version="1.0")
        return ASRData.model_validate_json(self.result)


class APIError(Exception):
    """接口调用错误"""
    def __init__(self, code, msg) -> None:
        self.code = code
        self.msg = msg
        super().__init__()

    def __str__(self) -> str:
        return f"{self.code}:{self.msg}"


# ─── BcutASR 主类 ───────────────────────────────────────────

class BcutASR:
    """必剪 语音识别接口（包含 412 修复与代理重试机制）"""
    session: requests.Session
    sound_name: str
    sound_bin: bytes
    sound_fmt: SUPPORT_SOUND_FORMAT
    __in_boss_key: str
    __resource_id: str
    __upload_id: str
    __upload_urls: list[str]
    __per_size: int
    __clips: int
    __etags: list[str]
    __download_url: str
    task_id: str

    def __init__(self, file: Optional[str | PathLike] = None, proxy: Optional[str] = None) -> None:
        self.session = requests.Session()
        if proxy:
            self.session.proxies = {
                "http": proxy,
                "https": proxy,
            }
        else:
            self.session.trust_env = False
            
        # ⚠️ 关键修复：添加 User-Agent, Cache-Control, Referer 规避 412 错误
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Cache-Control": "no-cache",
            "Referer": "https://member.bilibili.com/platform/home",
            "Origin": "https://member.bilibili.com"
        })
        self.task_id = None
        self.__etags = []
        if file:
            self.set_data(file)

    def _request(self, method: str, url: str, max_retries: int = 3, **kwargs) -> requests.Response:
        """发送请求，带重试机制，如果发生代理连接/5xx服务错误，则自动降级为直连或重试"""
        last_exception = None
        for attempt in range(1, max_retries + 1):
            try:
                resp = self.session.request(method, url, **kwargs)
                
                # 如果是 5xx 服务端临时错误，抛出以触发重试
                if resp.status_code in [500, 502, 503, 504]:
                    resp.raise_for_status()
                    
                resp.raise_for_status()
                return resp
            except Exception as e:
                last_exception = e
                logging.warning(f"请求 {url} 失败 (第 {attempt}/{max_retries} 次尝试): {e}")
                
                # 如果是代理相关的错误，先尝试关闭代理
                if isinstance(e, (requests.exceptions.ProxyError, requests.exceptions.ConnectionError)):
                    if self.session.proxies or self.session.trust_env:
                        logging.warning("正在尝试禁用代理并直连重试...")
                        self.session.proxies = {}
                        self.session.trust_env = False
                
                if attempt < max_retries:
                    # 指数退避延时
                    sleep_time = attempt * 2
                    time.sleep(sleep_time)
                    
        # 达到最大重试次数，仍失败则抛出最后一次异常
        if last_exception:
            raise last_exception

    def set_data(
        self,
        file: Optional[str | PathLike] = None,
        raw_data: Optional[bytes] = None,
        data_fmt: Optional[SUPPORT_SOUND_FORMAT] = None,
    ) -> None:
        """设置欲识别的数据"""
        if file:
            if not isinstance(file, (str, PathLike)):
                raise TypeError("未知的文件类型")
            file = Path(file)
            self.sound_bin = open(file, "rb").read()
            suffix = data_fmt or file.suffix[1:]
            self.sound_name = file.name
        elif raw_data:
            self.sound_bin = raw_data
            suffix = data_fmt
            self.sound_name = f"{int(time.time())}.{suffix}"
        else:
            raise ValueError("未提供有效的数据")

        if suffix.lower() == "mp3":
            suffix = "mp3"
        elif suffix.lower() == "aac":
            suffix = "aac"
        elif suffix.lower() == "m4a":
            suffix = "m4a"
        elif suffix.lower() == "wav":
            suffix = "wav"
        elif suffix.lower() == "flac":
            suffix = "flac"
        else:
            raise TypeError(f"不支持的音频格式: {suffix}")

        self.sound_fmt = suffix
        logging.info(f"加载音频文件成功: {self.sound_name} (格式: {self.sound_fmt})")

    def upload(self) -> None:
        """申请上传"""
        if not self.sound_bin or not self.sound_fmt:
            raise ValueError("未初始化音频数据")
        
        resp = self._request(
            "POST",
            API_REQ_UPLOAD,
            data={
                "type": 2,
                "name": self.sound_name,
                "size": len(self.sound_bin),
                "resource_file_type": self.sound_fmt,
                "model_id": 7,
            },
        )
        resp = resp.json()
        code = resp["code"]
        if code:
            raise APIError(code, resp["message"])
        
        resp_data = ResourceCreateRspSchema.model_validate(resp["data"])
        self.__in_boss_key = resp_data.in_boss_key
        self.__resource_id = resp_data.resource_id
        self.__upload_id = resp_data.upload_id
        self.__upload_urls = resp_data.upload_urls
        self.__per_size = resp_data.per_size
        self.__clips = len(resp_data.upload_urls)
        
        logging.info(
            f"申请上传成功, 总大小{resp_data.size // 1024}KB, {self.__clips}分片, 分片大小{resp_data.per_size // 1024}KB"
        )
        self.__upload_part()
        self.__commit_upload()

    def __upload_part(self) -> None:
        """上传音频数据分片"""
        for clip in range(self.__clips):
            start_range = clip * self.__per_size
            end_range = (clip + 1) * self.__per_size
            logging.info(f"开始上传分片 {clip+1}/{self.__clips}")
            
            resp = self._request(
                "PUT",
                self.__upload_urls[clip],
                data=self.sound_bin[start_range:end_range],
            )
            etag = resp.headers.get("Etag")
            if not etag:
                # 若无 Etag 头，则使用 md5 代替（某些 COS 节点需要）
                etag = hashlib.md5(self.sound_bin[start_range:end_range]).hexdigest()
            self.__etags.append(etag.strip('"'))
            logging.info(f"分片 {clip+1} 上传成功: {etag}")

    def __commit_upload(self) -> None:
        """提交上传数据"""
        resp = self._request(
            "POST",
            API_COMMIT_UPLOAD,
            data={
                "in_boss_key": self.__in_boss_key,
                "resource_id": self.__resource_id,
                "etags": ",".join(self.__etags),
                "upload_id": self.__upload_id,
                "model_id": 7,
            },
        )
        resp = resp.json()
        code = resp["code"]
        if code:
            raise APIError(code, resp["message"])
        
        resp_data = ResourceCompleteRspSchema.model_validate(resp["data"])
        self.__download_url = resp_data.download_url
        logging.info(f"音频提交归档完成")

    def create_task(self) -> str:
        """开始创建转换任务"""
        resp = self._request(
            "POST",
            API_CREATE_TASK, json={"resource": self.__download_url, "model_id": "7"}
        )
        resp = resp.json()
        code = resp["code"]
        if code:
            raise APIError(code, resp["message"])
        
        resp_data = TaskCreateRspSchema.model_validate(resp["data"])
        self.task_id = resp_data.task_id
        logging.info(f"语音转文字任务已在云端创建, 任务ID: {self.task_id}")
        return self.task_id

    def result(self, task_id: Optional[str] = None) -> ResultRspSchema:
        """查询转换结果"""
        resp = self._request(
            "GET",
            API_QUERY_RESULT, params={"model_id": 7, "task_id": task_id or self.task_id}
        )
        resp = resp.json()
        code = resp["code"]
        if code:
            raise APIError(code, resp["message"])
        
        return ResultRspSchema.model_validate(resp["data"])
