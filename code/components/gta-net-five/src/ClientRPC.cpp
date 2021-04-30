#include <StdInc.h>
#include <ScriptEngine.h>
#include <RpcConfiguration.h>

#include <fxScripting.h>

#include <NetLibrary.h>
#include <NetBuffer.h>

#include <Resource.h>
#include <ResourceManager.h>

#include <NetworkPlayerMgr.h>

#include <netObject.h>
#include <EntitySystem.h>

#include <ICoreGameInit.h>

#include <Hooking.h>

#include <EntitySystem.h>
#include <scrEngine.h>

extern NetLibrary* g_netLibrary;

#include <nutsnbolts.h>

#include <concurrentqueue.h>

class FxNativeInvoke
{
private:
	static inline void Invoke(fx::ScriptContext& cxt, const boost::optional<fx::TNativeHandler>& handler)
	{
		(*handler)(cxt);
	}

public:
	template<typename R, typename... Args>
	static inline R Invoke(const boost::optional<fx::TNativeHandler>& handler, Args... args)
	{
		fx::ScriptContextBuffer cxt;

		pass{ ([&]()
		{
			cxt.Push(args);
		}(),
		1)... };

		Invoke(cxt, handler);

		return cxt.GetResult<R>();
	}
};

static std::shared_ptr<RpcConfiguration> g_rpcConfiguration;

struct ResourceActivationScope
{
	ResourceActivationScope(fx::Resource* resource)
	{
		resource->OnActivate();

		m_resource = resource;
	}

	~ResourceActivationScope()
	{
		m_resource->OnDeactivate();

		m_resource = nullptr;
	}

private:
	fx::Resource* m_resource;
};

class RpcNextTickQueue : public fwRefCountable, public fx::IAttached<fx::Resource>
{
private:
	struct QueuedEvent
	{
		std::function<void()> fn;
		std::function<bool()> cond;
	};

public:
	virtual void AttachToObject(fx::Resource* resource) override
	{
		resource->OnTick.Connect([=]()
		{
			QueuedEvent entry;
			std::unique_ptr<std::queue<QueuedEvent>> pushQueue;

			while (m_queue.try_dequeue(entry))
			{
				ResourceActivationScope activationScope(resource);

				if (entry.cond && !entry.cond())
				{
					if (!pushQueue)
					{
						pushQueue = std::make_unique<std::queue<QueuedEvent>>();
					}

					pushQueue->push(std::move(entry));
					continue;
				}

				entry.fn();
			}

			if (pushQueue)
			{
				while (!pushQueue->empty())
				{
					ResourceActivationScope activationScope(resource);

					auto& entry = pushQueue->front();
					m_queue.enqueue(std::move(entry));

					pushQueue->pop();
				}
			}
		});
	}

	void Enqueue(const std::function<void()>& fn, const std::function<bool()>& condition = {})
	{
		m_queue.enqueue({ fn, condition });
	}

private:
	moodycamel::ConcurrentQueue<QueuedEvent> m_queue;
};

class DummyScriptEnvironment : public fx::OMClass<DummyScriptEnvironment, IScriptRuntime>
{
public:
	NS_DECL_ISCRIPTRUNTIME;

private:
	void* m_parentObject;
};

result_t DummyScriptEnvironment::Create(IScriptHost *scriptHost)
{
	return FX_S_OK;
}

result_t DummyScriptEnvironment::Destroy()
{
	return FX_S_OK;
}

int DummyScriptEnvironment::GetInstanceId()
{
	return 1;
}

void* DummyScriptEnvironment::GetParentObject()
{
	return m_parentObject;
}

void DummyScriptEnvironment::SetParentObject(void* object)
{
	m_parentObject = object;
}

DummyScriptEnvironment g_se;

DECLARE_INSTANCE_TYPE(RpcNextTickQueue);

int ObjectToEntity(int objectId);

namespace sync
{
std::map<int, int> g_creationTokenToObjectId;
std::map<int, uint32_t> g_objectIdToCreationToken;

static hook::cdecl_stub<void*(int handle)> getScriptEntity([]()
{
	return hook::pattern("44 8B C1 49 8B 41 08 41 C1 F8 08 41 38 0C 00").count(1).get(0).get<void>(-12);
});

extern int getPlayerId();

static InitFunction initFunction([]()
{
	fx::Resource::OnInitializeInstance.Connect([](fx::Resource* resource)
	{
		resource->SetComponent(new RpcNextTickQueue());
	});

	OnGameFrame.Connect([]()
	{
		static auto icgi = Instance<ICoreGameInit>::Get();

		if (g_netLibrary == nullptr)
		{
			return;
		}

		if (g_netLibrary)
		{
			static bool g_netlibHookInited;

			if (!g_netlibHookInited)
			{
				g_se.AddRef();

				g_rpcConfiguration = RpcConfiguration::Load("citizen:/scripting/rpc_natives.json");

				g_netLibrary->AddReliableHandler("msgRpcEntityCreation", [](const char* data, size_t len)
				{
					net::Buffer buffer(reinterpret_cast<const uint8_t*>(data), len);

					uint16_t creationToken = buffer.Read<uint16_t>();
					uint16_t objectId = buffer.Read<uint16_t>();

					g_creationTokenToObjectId[creationToken] = (1 << 16) | objectId;
				});

				g_netLibrary->AddReliableHandler("msgRpcNative", [](const char* data, size_t len)
				{
					static auto getByServerId = fx::ScriptEngine::GetNativeHandler(HashString("GET_PLAYER_FROM_SERVER_ID"));
					std::shared_ptr<net::Buffer> buf = std::make_shared<net::Buffer>(reinterpret_cast<const uint8_t*>(data), len);

					auto nativeHash = buf->Read<uint64_t>();
					auto resourceHash = buf->Read<uint32_t>();

					// TODO: FIXME: optimize this, it's O(n)
					fx::Resource* resource = nullptr;
					fx::ResourceManager* manager = Instance<fx::ResourceManager>::Get();

					manager->ForAllResources([&](fwRefContainer<fx::Resource> thisResource)
					{
						if (HashString(thisResource->GetName().c_str()) == resourceHash)
						{
							resource = thisResource.GetRef();
						}
					});

					std::shared_ptr<RpcConfiguration::Native> native;

					for (auto& n : g_rpcConfiguration->GetNatives())
					{
						if (n->GetGameHash() == nativeHash)
						{
							native = n;
							break;
						}
					}

					if (!native || !resource)
					{
						return;
					}

					static std::map<uint32_t, uint32_t> objectsToIds;

					auto getObject = [](uint32_t idx)
					{
						return objectsToIds[idx];
					};

					auto storeObject = [](uint32_t idx, uint32_t hdl)
					{
						objectsToIds[idx] = hdl;
					};

					uint32_t creationToken;

					if (native->GetRpcType() == RpcConfiguration::RpcType::EntityCreate)
					{
						if (icgi->NetProtoVersion < 0x202002271209)
						{
							creationToken = buf->Read<uint16_t>();
						}
						else
						{
							creationToken = buf->Read<uint32_t>();
						}
					}
					else if (native->GetRpcType() == RpcConfiguration::RpcType::ObjectCreate)
					{
						creationToken = buf->Read<uint32_t>();
					}

					auto startPosition = buf->GetCurOffset();

					if (resource)
					{
						// gather conditions
						auto ntq = resource->GetComponent<RpcNextTickQueue>();

						int i = 0;

						std::vector<std::function<void()>> afterCallbacks;
						std::vector<std::function<bool()>> conditions;

						for (auto& argument : native->GetArguments())
						{
							switch (argument.GetType())
							{
							case RpcConfiguration::ArgumentType::Player:
							{
								if (icgi->NetProtoVersion >= 0x202103030422)
								{
									buf->Read<uint16_t>();
								}
								else
								{
									buf->Read<uint8_t>();
								}

								break;
							}
							case RpcConfiguration::ArgumentType::ObjRef:
							case RpcConfiguration::ArgumentType::ObjDel:
							{
								buf->Read<uint32_t>();
								break;
							}
							case RpcConfiguration::ArgumentType::Entity:
							{
								uint32_t entity = buf->Read<uint32_t>();

								if (entity & 0x80000000)
								{
									conditions.push_back([=]()
									{
										auto it = g_creationTokenToObjectId.find(entity & 0x7FFFFFFF);

										if (it != g_creationTokenToObjectId.end())
										{
											if (ObjectToEntity(it->second) != -1)
											{
												return true;
											}
										}

										return false;
									});
								}

								break;
							}
							case RpcConfiguration::ArgumentType::Int:
								buf->Read<int>();
								break;
							case RpcConfiguration::ArgumentType::Hash:
							{
								uint32_t hash = buf->Read<int>();
								rage::fwModelId idx; // unused

								if (native->GetRpcType() == RpcConfiguration::RpcType::EntityCreate || rage::fwArchetypeManager::GetArchetypeFromHashKey(hash, idx))
								{
									ntq->Enqueue([=]()
									{
										const uint64_t REQUEST_MODEL_GTA5 = 0x963D27A58DF860AC;

										fx::ScriptContextBuffer reqCtx;
										reqCtx.Push(hash);

										(*fx::ScriptEngine::GetNativeHandler(REQUEST_MODEL_GTA5))(reqCtx);
									});

									conditions.push_back([=]()
									{
										const uint64_t HAS_MODEL_LOADED_GTA5 = 0x98A4EB5D89A0C952;

										fx::ScriptContextBuffer loadedCtx;
										loadedCtx.Push(hash);

										(*fx::ScriptEngine::GetNativeHandler(HAS_MODEL_LOADED_GTA5))(loadedCtx);

										return loadedCtx.GetResult<bool>();
									});

									afterCallbacks.push_back([=]()
									{
										const uint64_t SET_MODEL_AS_NO_LONGER_NEEDED_GTA5 = 0xE532F5D78798DAAB;

										fx::ScriptContextBuffer releaseCtx;
										releaseCtx.Push(hash);

										(*fx::ScriptEngine::GetNativeHandler(SET_MODEL_AS_NO_LONGER_NEEDED_GTA5))(releaseCtx);
									});
								}

								break;
							}
							case RpcConfiguration::ArgumentType::Float:
								buf->Read<float>();
								break;
							case RpcConfiguration::ArgumentType::Bool:
								buf->Read<uint8_t>();
								break;
							case RpcConfiguration::ArgumentType::String:
							{
								// TODO: actually store a string
								break;
							}
							}

							++i;
						}

						std::function<bool()> conditionFunc;
							
						if (!conditions.empty())
						{
							conditionFunc = [=]()
							{
								for (auto& condition : conditions)
								{
									if (!condition())
									{
										return false;
									}
								}

								return true;
							};
						}

						// execute native
						ntq->Enqueue([=]()
						{
							buf->Seek(startPosition);

							auto executionCtx = std::make_shared<fx::ScriptContextBuffer>();
							std::vector<std::string> strings;

							int i = 0;

							for (auto& argument : native->GetArguments())
							{
								switch (argument.GetType())
								{
								case RpcConfiguration::ArgumentType::Player:
								{
									if (icgi->NetProtoVersion >= 0x202103030422)
									{
										uint32_t netId = buf->Read<uint16_t>();
										auto playerId = FxNativeInvoke::Invoke<uint32_t>(getByServerId, netId);

										if (playerId == 0xFFFFFFFF)
										{
											return;
										}

										executionCtx->Push(playerId);
									}
									else
									{
										int id = buf->Read<uint8_t>();
										executionCtx->Push(uint32_t(id));
									}

									break;
								}
								case RpcConfiguration::ArgumentType::Entity:
								{
									uint32_t entity = buf->Read<uint32_t>();

									if (entity & 0x80000000)
									{
										entity = g_creationTokenToObjectId[entity & 0x7FFFFFFF];
									}

									executionCtx->Push(ObjectToEntity(entity));

									break;
								}
								case RpcConfiguration::ArgumentType::Int:
								case RpcConfiguration::ArgumentType::Hash:
									executionCtx->Push(buf->Read<int>());
									break;
								case RpcConfiguration::ArgumentType::Float:
									executionCtx->Push(buf->Read<float>());
									break;
								case RpcConfiguration::ArgumentType::Bool:
									executionCtx->Push(buf->Read<uint8_t>());
									break;
								case RpcConfiguration::ArgumentType::ObjRef:
									executionCtx->Push(getObject(buf->Read<uint32_t>()));
									break;
								case RpcConfiguration::ArgumentType::ObjDel:
									static uint32_t toDel = getObject(buf->Read<uint32_t>());
									executionCtx->Push(&toDel);
									break;
								case RpcConfiguration::ArgumentType::String:
								{
									uint16_t slen = buf->Read<uint16_t>();
									static char srbuf[UINT16_MAX + 1];
									buf->Read(srbuf, slen);

									strings.push_back(std::string{ srbuf, slen });
									executionCtx->Push(strings.back().c_str());

									break;
								}
								}

								++i;
							}

							g_se.SetParentObject(resource);

							fx::PushEnvironment pushed(&g_se);
							auto n = fx::ScriptEngine::GetNativeHandler(nativeHash);

							if (n)
							{
								try
								{
									(*n)(*executionCtx);
								}
								catch (std::exception& e)
								{
									trace("failure executing native rpc: %s\n", e.what());
									return;
								}

								if (native->GetRpcType() == RpcConfiguration::RpcType::EntityCreate)
								{
									int entityIdx = executionCtx->GetResult<int>();

									auto entity = (fwEntity*)getScriptEntity(entityIdx);

									if (entity)
									{
										auto object = (rage::netObject*)entity->GetNetObject();

										if (object)
										{
											auto obj = object->objectId;

											g_creationTokenToObjectId[creationToken] = (1 << 16) | obj;

											if (icgi->NetProtoVersion < 0x202002271209)
											{
												net::Buffer netBuffer;

												netBuffer.Write<uint16_t>(creationToken);
												netBuffer.Write<uint16_t>(obj); // object ID (short)

												g_netLibrary->SendReliableCommand("msgEntityCreate", (const char*)netBuffer.GetData().data(), netBuffer.GetCurOffset());
											}
											else
											{
												g_objectIdToCreationToken[obj] = creationToken;
											}
										}
									}
								}
								else if (native->GetRpcType() == RpcConfiguration::RpcType::ObjectCreate)
								{
									storeObject(creationToken, executionCtx->GetResult<int>());
								}

								for (auto& cb : afterCallbacks)
								{
									cb();
								}
							}
						}, conditionFunc);
					}
				});

				g_netlibHookInited = true;
			}
		}
	});
});
}
