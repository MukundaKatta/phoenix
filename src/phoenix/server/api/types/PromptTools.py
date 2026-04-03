from __future__ import annotations

from enum import Enum
from typing import TYPE_CHECKING

import strawberry
from strawberry.scalars import JSON

from phoenix.db.types.db_helper_types import UNDEFINED
from phoenix.db.types.prompts import PromptVendorTools as OrmPromptVendorTools

from .PromptToolChoice import PromptToolChoice


@strawberry.enum
class ToolVendorSDK(Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GOOGLE_GENAI = "google_genai"
    AWS_BEDROCK = "aws_bedrock"

    def to_orm(self) -> orm.ToolVendorSDK:
        return self.value


if TYPE_CHECKING:
    from phoenix.db.types import prompts as orm


@strawberry.type
class PromptToolFunctionDefinition:
    name: str
    description: str | None
    parameters: JSON
    strict: bool | None

    @classmethod
    def from_orm(cls, d: orm.PromptToolFunctionDefinition) -> PromptToolFunctionDefinition:
        return cls(
            name=d.name,
            description=d.description if d.description else None,
            parameters=JSON(d.parameters),
            strict=d.strict if isinstance(d.strict, bool) else None,
        )


@strawberry.type
class PromptToolFunction:
    function: PromptToolFunctionDefinition

    @classmethod
    def from_orm(cls, t: orm.PromptToolFunction) -> PromptToolFunction:
        return cls(function=PromptToolFunctionDefinition.from_orm(t.function))


@strawberry.type
class PromptVendorTools:
    vendor_sdk: ToolVendorSDK
    definitions: list[JSON]

    @classmethod
    def from_orm(cls, t: OrmPromptVendorTools) -> PromptVendorTools:
        return cls(
            vendor_sdk=ToolVendorSDK(t.vendor_sdk),
            definitions=t.definitions,
        )


@strawberry.type
class PromptTools:
    function_tools: list[PromptToolFunction] | None
    vendor_tools: PromptVendorTools | None
    tool_choice: PromptToolChoice | None
    disable_parallel_tool_calls: bool | None

    def __post_init__(self) -> None:
        if bool(self.function_tools) == bool(self.vendor_tools):
            raise ValueError("PromptTools: set exactly one of function_tools or vendor_tools")

    @classmethod
    def from_orm(cls, orm_tools: orm.PromptTools) -> PromptTools:
        function_tools: list[PromptToolFunction] | None = None
        vendor_tools: PromptVendorTools | None = None

        if isinstance(orm_tools.tools, list):
            function_tools = [PromptToolFunction.from_orm(t) for t in orm_tools.tools]
        elif isinstance(orm_tools.tools, OrmPromptVendorTools):
            vendor_tools = PromptVendorTools.from_orm(orm_tools.tools)

        tool_choice = (
            PromptToolChoice.from_orm(orm_tools.tool_choice)
            if orm_tools.tool_choice is not UNDEFINED and orm_tools.tool_choice is not None
            else None
        )
        disable_parallel = (
            orm_tools.disable_parallel_tool_calls
            if isinstance(orm_tools.disable_parallel_tool_calls, bool)
            else None
        )
        return cls(
            function_tools=function_tools,
            vendor_tools=vendor_tools,
            tool_choice=tool_choice,
            disable_parallel_tool_calls=disable_parallel,
        )
