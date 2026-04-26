from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field, model_validator


class WorkAuth(BaseModel):
    citizenships: list[str] = []
    sponsorship_needed: dict[str, bool] = {}
    relocate_to: list[str] = []


class Position(BaseModel):
    company: str
    title: str
    start: date
    end: Optional[date] = None
    location: Optional[str] = None
    employment_type: Literal["full_time", "contract", "internship"] = "full_time"
    description: Optional[str] = None

    @model_validator(mode="after")
    def _dates_ordered(self):
        if self.end and self.end < self.start:
            raise ValueError("end before start")
        return self


class Education(BaseModel):
    institution: str
    degree: str
    field: Optional[str] = None
    start: Optional[date] = None
    end: Optional[date] = None


class Preferences(BaseModel):
    salary_floor_usd: Optional[int] = None
    salary_target_usd: Optional[int] = None
    role_families: list[str] = []
    dealbreakers: list[str] = []
    company_stages: list[
        Literal["pre_seed", "seed", "series_a", "series_b_plus", "public"]
    ] = []
    work_modes: list[Literal["remote", "hybrid", "onsite"]] = []
    cover_letter_default: bool = True
    disclose_salary_default: bool = False


class EEODefaults(BaseModel):
    gender: Optional[str] = None
    race_ethnicity: Optional[str] = None
    veteran: Optional[str] = None
    disability: Optional[str] = None


class Profile(BaseModel):
    legal_name: str
    preferred_name: Optional[str] = None
    email: EmailStr
    phone: Optional[str] = None
    address: Optional[str] = None
    links: dict[str, str] = {}
    work_auth: WorkAuth = Field(default_factory=WorkAuth)
    positions: list[Position] = []
    education: list[Education] = []
    languages: list[str] = []
    preferences: Preferences = Field(default_factory=Preferences)
    eeo: EEODefaults = Field(default_factory=EEODefaults)
    kill_list: list[str] = []
