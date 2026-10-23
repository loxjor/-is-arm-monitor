"""Ошибки бизнес-логики. Роутеры переводят их в HTTP-коды, сервисы о HTTP не знают."""


class NotFoundError(LookupError):
    pass


class ConflictError(ValueError):
    pass
