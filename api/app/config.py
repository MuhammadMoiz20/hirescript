from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_password: str
    session_secret: str
    database_url: str

    storage_endpoint_url: str = "http://minio:9000"
    storage_access_key: str = "minio"
    storage_secret_key: str = "minio12345"
    storage_bucket: str = "hirescript-pdfs"
    storage_region: str = "us-east-1"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
