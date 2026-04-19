# -*- coding: utf-8 -*-
"""API config models stored in MongoDB — allows runtime changes without restart."""
from datetime import datetime
from mongoengine import Document, StringField, BooleanField, IntField, FloatField


class LLMConfig(Document):
    """LLM provider configuration — supports MiniMax, OpenAI, OpenRouter, etc."""
    _id = 'llm_config'  # singleton

    provider = StringField(required=True, choices=['minimax', 'openai', 'openrouter', 'anthropic'])
    api_base = StringField(required=True)  # e.g. https://api.minimax.io/v1
    api_key = StringField(required=True)
    model = StringField(required=True)  # e.g. MiniMax-M2.7, gpt-4o, claude-3-opus
    temperature = FloatField(default=0.3)
    max_tokens = IntField(default=1024)
    is_active = BooleanField(default=True)
    updated_at = StringField(default=datetime.utcnow().isoformat)

    meta = {'collection': 'llm_configs', 'allow_inheritance': False}

    def save(self, *args, **kwargs):
        self.updated_at = datetime.utcnow().isoformat()
        return super().save(*args, **kwargs)

    def to_dict(self):
        return {
            'provider': self.provider,
            'api_base': self.api_base,
            'model': self.model,
            'temperature': self.temperature,
            'max_tokens': self.max_tokens,
            'is_active': self.is_active
            # Don't expose api_key in dict
        }

    @classmethod
    def get_active(cls):
        """Return the active LLM config, or None."""
        return cls.objects(is_active=True).first()

    @classmethod
    def set_active(cls, provider, api_base, api_key, model, temperature=0.3, max_tokens=1024):
        """Set or create the active config."""
        # Deactivate all
        cls.objects.update(set__is_active=False)
        # Create new
        config = cls(
            _id='llm_config',
            provider=provider,
            api_base=api_base,
            api_key=api_key,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            is_active=True
        )
        config.save()
        return config


class WhisperConfig(Document):
    """Whisper API configuration for voice transcription."""
    _id = 'whisper_config'

    provider = StringField(required=True, choices=['openai', 'minimax', 'local'])
    api_base = StringField(required=True)  # e.g. https://api.openai.com/v1
    api_key = StringField(required=True)
    model = StringField(default='whisper-1')
    language = StringField(default='')  # empty = auto-detect
    enabled = BooleanField(default=False)
    updated_at = StringField(default=datetime.utcnow().isoformat())

    meta = {'collection': 'whisper_configs', 'allow_inheritance': False}

    def save(self, *args, **kwargs):
        self.updated_at = datetime.utcnow().isoformat()
        return super().save(*args, **kwargs)

    @classmethod
    def get_active(cls):
        return cls.objects.first()

    @classmethod
    def set_config(cls, provider, api_base, api_key, model='whisper-1', language='', enabled=False):
        existing = cls.objects.first()
        if existing:
            existing.provider = provider
            existing.api_base = api_base
            existing.api_key = api_key
            existing.model = model
            existing.language = language
            existing.enabled = enabled
            existing.save()
        else:
            existing = cls(
                _id='whisper_config',
                provider=provider,
                api_base=api_base,
                api_key=api_key,
                model=model,
                language=language,
                enabled=enabled
            )
            existing.save()
        return existing
