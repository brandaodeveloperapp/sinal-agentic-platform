"""Pydantic models describing the Onda Telecom fictional domain."""

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from pydantic import BaseModel, Field


class LineStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    CANCELLED = "cancelled"


class InvoiceStatus(StrEnum):
    OPEN = "open"
    PAID = "paid"
    OVERDUE = "overdue"


class TicketStatus(StrEnum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"


class TicketCategory(StrEnum):
    BILLING = "billing"
    NETWORK = "network"
    DEVICE = "device"
    PLAN_CHANGE = "plan_change"


class Plan(BaseModel):
    id: str
    name: str
    monthly_price: Decimal
    data_allowance_gb: int
    unlimited_apps: list[str]
    minutes: str


class Customer(BaseModel):
    id: str
    full_name: str
    document: str = Field(description="Masked national document identifier")
    segment: str
    since: date
    email: str


class Line(BaseModel):
    msisdn: str
    customer_id: str
    plan_id: str
    status: LineStatus
    activated_at: date


class UsageWindow(BaseModel):
    msisdn: str
    cycle_start: date
    cycle_end: date
    data_used_gb: Decimal
    data_allowance_gb: int
    minutes_used: int
    sms_used: int
    roaming_active: bool

    @property
    def data_remaining_gb(self) -> Decimal:
        return max(Decimal("0"), Decimal(self.data_allowance_gb) - self.data_used_gb)


class Invoice(BaseModel):
    id: str
    customer_id: str
    reference_month: str
    due_date: date
    amount: Decimal
    status: InvoiceStatus
    barcode: str | None = None


class Ticket(BaseModel):
    id: str
    customer_id: str
    category: TicketCategory
    status: TicketStatus
    summary: str
    opened_at: datetime
    opened_by: str


class TicketCreateRequest(BaseModel):
    customer_id: str
    category: TicketCategory
    summary: str = Field(min_length=10, max_length=280)


class ErrorResponse(BaseModel):
    code: str
    message: str
    correlation_id: str
