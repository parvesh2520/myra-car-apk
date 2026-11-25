import importlib
import os


def test_api_keys_are_stripped_of_pasted_whitespace(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "\tsk_test_key \n")
    monkeypatch.setenv("BD_SOMETHING_ELSE", " keep ")
    import bhashadrive.config as config
    importlib.reload(config)
    assert os.environ["SARVAM_API_KEY"] == "sk_test_key"
    assert config.AssistantConfig().sarvam_api_key == "sk_test_key"
    assert os.environ["BD_SOMETHING_ELSE"] == " keep "  # only *_API_KEY variables are touched
