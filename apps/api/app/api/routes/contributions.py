from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/contributions", tags=["contributions"])


@router.post("")
async def submit_contribution():
    raise HTTPException(
        status_code=410,
        detail={
            "code": "contribution_workflow_moved",
            "message": "旧投稿入口已停用，请登录后使用 /api/v1/submissions。",
        },
    )
