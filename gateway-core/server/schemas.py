"""요청·응답 모양. 요청에는 범주 ID와 숫자만 있고, 입력 원문이나 파일 내용이 들어갈 자리가 없습니다.

`extra="forbid"`라서 정의하지 않은 항목(예: text, content, filename)이 오면 422로 거부합니다.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .decision import FileStatus

CategoryId = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,63}$")]


class DecideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detected_categories: list[CategoryId] = Field(default_factory=list, max_length=32)
    channel: Literal["prompt", "file"] = "prompt"
    # 첨부파일일 때만: 검사 상태와 (표에서) 감지된 행 수
    file_status: FileStatus | None = None
    record_count: int = Field(default=0, ge=0, le=10_000_000)
    # 특정 정책 버전으로 판정하고 싶을 때. 없으면 활성 버전.
    policy_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _check_channel(self) -> "DecideRequest":
        if self.channel == "file":
            if self.file_status is None:
                raise ValueError("channel이 file이면 file_status가 필요합니다.")
        elif self.file_status is not None or self.record_count != 0:
            raise ValueError("file_status·record_count는 channel이 file일 때만 쓸 수 있습니다.")
        return self


class DecideResponse(BaseModel):
    decision_id: str
    action: Literal["ALLOW", "MASK", "REQUIRE_APPROVAL", "BLOCK"]
    reason_codes: list[str]
    policy_id: str
    policy_version: int


class PolicyVersionInfo(BaseModel):
    version: int
    active: bool
    etag: str
    description: str
