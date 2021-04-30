#include <StdInc.h>
#include <EntitySystem.h>

#include <Hooking.h>

static hook::cdecl_stub<fwEntity* (int handle)> getScriptEntity([]()
{
	return hook::pattern("44 8B C1 49 8B 41 08 41 C1 F8 08 41 38 0C 00").count(1).get(0).get<void>(-12);
});

fwEntity* rage::fwScriptGuid::GetBaseFromGuid(int handle)
{
	return getScriptEntity(handle);
}

static hook::cdecl_stub<void* (fwExtensionList*, uint32_t)> getExtension([]()
{
	return hook::get_pattern("8B FA 83 FA 20 73 17 8B C7", -15);
});

void* fwExtensionList::Get(uint32_t id)
{
	return getExtension(this, id);
}

static uint32_t* fwSceneUpdateExtension_classId;

uint32_t fwSceneUpdateExtension::GetClassId()
{
	return *fwSceneUpdateExtension_classId;
}

static HookFunction hookFunction([]
{
	fwSceneUpdateExtension_classId = hook::get_address<uint32_t*>(hook::get_pattern("48 8B D3 48 89 73 08 E8", -64));
});

static hook::cdecl_stub<fwArchetype*(uint32_t nameHash, rage::fwModelId& archetypeUnk)> getArchetype([]()
{
	return hook::get_call(hook::pattern("89 44 24 40 8B 4F 08 80 E3 01 E8").count(1).get(0).get<void>(10));
});

fwArchetype* rage::fwArchetypeManager::GetArchetypeFromHashKey(uint32_t hash, fwModelId& id)
{
	return getArchetype(hash, id);
}
