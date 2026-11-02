"""Focused CPU regression for the pinned diffusers / LAM attention boundary."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'FLAME/lam/upstream'))
import torch
from diffusers.models.attention import Attention
from diffusers.models.attention_processor import JointAttnProcessor2_0
from lam.models.transformer_dit import QKNormJointAttnProcessor2_0

torch.manual_seed(42)
attention = Attention(query_dim=8, heads=2, dim_head=4, added_kv_proj_dim=8,
                      context_pre_only=False, qk_norm='rms_norm')
counts = [0, 0]
def count(index):
    def hook(*_): counts[index] += 1
    return hook
attention.norm_q.register_forward_hook(count(0))
attention.norm_k.register_forward_hook(count(1))
x, context = torch.randn(1, 3, 8), torch.randn(1, 2, 8)
attention.set_processor(JointAttnProcessor2_0())
baseline = attention(x, encoder_hidden_states=context)[0]
assert counts == [0, 0], 'Pinned baseline changed; reconsider the compatibility adapter'
attention.set_processor(QKNormJointAttnProcessor2_0())
corrected = attention(x, encoder_hidden_states=context)[0]
assert counts == [1, 1] and not torch.allclose(baseline, corrected)
print('Stock processor: Q/K norm calls 0/0; LAM processor: 1/1, output differs as expected')
