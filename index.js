require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const jsonexport = require("jsonexport");

function filterDateIn(startDate, endDate) {
	return action => {
		const d = new Date(action.date);
		return d > startDate && d < endDate;
	};
}

function sortByItemName(a, b) {
	if (a.item?.toLowerCase() < b.item?.toLowerCase()) {
		return -1;
	}
	if (a.item?.toLowerCase() > b.item?.toLowerCase()) {
		return 1;
	}
	return 0;
}

function formatDate(dateString) {
	return dateString.substr(0, 10);
}

function writeJsonToCsv(actions, csvFile) {
	const options = {
		headers: [
			"project",
			"member",
			"item",
			"progress",
			"date",
			"done",
			"todos",
			"additionalRate",
		],
	};

	jsonexport(actions, options, (err, csv) => {
		if (!err) fs.writeFileSync(csvFile, csv);
	});
}

const readline = require("readline").createInterface({
	input: process.stdin,
	output: process.stdout,
});

readline.question("Input day offset. (default: 7)", (offsetDate = "7") => {
	const today = new Date();
	const offsetDay = offsetDate ? Number(offsetDate) : 7;
	const startDate = new Date(
		today.getFullYear(),
		today.getMonth(),
		today.getDate() - offsetDay
	);
	const endDate = new Date(
		today.getFullYear(),
		today.getMonth(),
		today.getDate() + 1
	);
	const todayDate = new Date(
		today.getFullYear(),
		today.getMonth(),
		today.getDate()
	);

	const url = "https://api.trello.com/1";
	const actionTypes = ["updateCheckItemStateOnCard" /*, "commentCard" */];
	const key = process.env.key;
	const token = process.env.token;
	if (!key || !token) {
		console.error("key and token have to be given.");
		readline.close();
		return;
	}
	const sufix = `key=${key}&token=${token}`;
	const filterOutLabels = ["canceled", "pending", "done"];

	axios
		.get(`${url}/members/me/boards?fields=name,url&` + sufix)
		.then(async res => {
			console.log(
				"all boards",
				res.data.map(x => x.name)
			);

			const boardData = res.data.filter(b =>
				["newmedia.projects", "newmedia.r&d"].includes(b.name.toLowerCase())
			);

			console.log(
				"boardData ",
				boardData.map(x => x.name)
			);

			const allTodoLists = [];
			const allActionLists = [];
			console.log("=============================");
			console.log("Getting todolists");
			for (const { name, id } of boardData) {
				console.log("fetching all cards of board ", name);
				let todosPerCards = [];
				try {
					const { data: allCards } = await axios.get(
						`${url}/boards/${id}/cards?filter=open&${sufix}`
					);
					console.log("all cards count", allCards.length);
					for (const card of allCards) {
						console.log(
							`==== card.name: ${card.name} labels: ${card.labels
								.map(l => l.name)
								.join(", ")} ====`
						);
						if (
							!card.idChecklists.length ||
							card.labels.filter(l =>
								filterOutLabels.includes(l.name.toLowerCase())
							).length > 0
						)
							continue;

						const { data: list } = await axios.get(
							`${url}/lists/${card.idList}?${sufix}`
						);
						if (list.name.toLowerCase().startsWith("how to use")) continue;

						const { data: members } = await axios.get(
							`${url}/cards/${card.id}/members?${sufix}`
						);

						const { data: checklists } = await axios.get(
							`${url}/cards/${card.id}/checklists?${sufix}`
						);

						const checklistItemsFilter = c =>
							!c.name.trim().startsWith("---") &&
							!c.name.trim().startsWith("===");

						const mainCheckLists = checklists
							.filter(cl => cl.name.toLowerCase().trim().startsWith("main"))
							.map(cl => ({
								...cl,
								checkItems: cl.checkItems.filter(checklistItemsFilter),
							}));

						let todoCheckLists = [];
						if (!mainCheckLists.length) {
							console.log(
								"no todo-list found in main checkItems. getting from todo-list..."
							);
							todoCheckLists = checklists
								.filter(cl => cl.name.trim().toLowerCase().startsWith("todo"))
								.map(cl => ({
									...cl,
									checkItems: cl.checkItems.filter(checklistItemsFilter),
								}));
							if (!todoCheckLists.length) continue;
							console.log(
								todoCheckLists.reduce((a, x) => a + x.checkItems.length, 0),
								" todo-list found in todo-list checkItems"
							);
						} else
							console.log(
								mainCheckLists.reduce((a, x) => a + x.checkItems.length, 0),
								" todo-list found in main-list checkItems"
							);

						const checkListItemsCount = [...mainCheckLists, ...todoCheckLists]
							.map(cl => cl.checkItems)
							.reduce(
								(acc, checkItems) => ({
									completed:
										acc.completed +
										checkItems.filter(ci => ci.state === "complete").length,
									total: acc.total + checkItems.length,
									additional:
										acc.additional +
										checkItems.filter(ci => ci.name.trim().startsWith("+"))
											.length,
								}),
								{
									completed: 0,
									total: 0,
									additional: 0,
								}
							);

						const progress =
							Math.round(
								(checkListItemsCount.completed / checkListItemsCount.total) *
								100
							) / 100;
						const additionalRate =
							Math.round(
								(checkListItemsCount.additional / checkListItemsCount.total) *
								100
							) / 100;

						console.log(
							`\t${card.name} progress: ${progress * 100}% <- ${checkListItemsCount.completed
							}/${checkListItemsCount.total} (+${additionalRate}% <- ${checkListItemsCount.additional
							})`
						);

						const todoItem = [...mainCheckLists, ...todoCheckLists]
							.map(cl => cl.checkItems.filter(c => c.state !== "complete"))
							.reduce(
								(acc, checkItems) => ({
									...acc,
									todos: [...acc.todos, ...checkItems],
								}),
								{
									project: list.name,
									item: card.name,
									member: members.map(m => m.fullName).join(", "),
									date: formatDate(today.toISOString()),
									progress,
									additionalRate,
									todos: [],
								}
							);

						todoItem.todos = todoItem.todos
							.sort((a, b) => (a.name > b.name ? 1 : -1))
							.map(c => `→ ${c.name}`)
							.join("\n");

						todosPerCards.push(todoItem);
					}
					console.log("todosPerCards", todosPerCards);
					allTodoLists.push({ board: name, data: todosPerCards });
				} catch (e) {
					/* handle error */
					console.error(e);
				}

				console.log("=============================");
				console.log("Getting actions");
				try {
					const { data: actionsFetched } = await axios.get(
						`${url}/boards/${id}/actions?filter=${actionTypes.join(
							","
						)}&${sufix}`
					);
					const actionLists = [];
					for (const action of actionsFetched
						.filter(filterDateIn(startDate, endDate))
						.filter(a =>
							a.type === "updateCheckItemStateOnCard"
								? a.data.checkItem.state === "complete"
								: true
						)) {
						console.log(
							"parsing action of type",
							action.type,
							" and of card ",
							action.data.card.name
						);
						const card = action.data.card;
						const { data: list } = await axios.get(
							`${url}/cards/${card.id}/list?${sufix}`
						);
						const { data: member } = await axios.get(
							`${url}/actions/${action.id}/memberCreator?${sufix}`
						);

						/*
						const { data: checklist } = await axios.get(
							`${url}/cards/${card.id}/checklists?${sufix}`
						);
						if (!checklist) {
							console.log("no checklist found");
							continue;
						}

						const mainCheckList = checklist.find(c =>
							c.name.toLowerCase().startsWith("main")
						);

						const progress = mainCheckList?.checkItems
							? Math.round(
									(mainCheckList.checkItems.filter(c => c.state === "complete")
										.length /
										mainCheckList.checkItems.length) *
										100
								) / 100
							: undefined;

						const done =
							action.type === "commentCard"
								? action.data.text
								: "✓ " + action.data.checkItem.name;
						*/

						const matchingTodoData = todosPerCards.filter(
							d => d.item === card.name
						);

						const progress =
							matchingTodoData.length > 0 ? matchingTodoData[0].progress : 0.0;

						const d = {
							project: list.name,
							member: member.fullName,
							item: card.name,
							progress,
							date: formatDate(action.date),
							done: "✓ " + action.data.checkItem.name,
						};

						actionLists.push(d);
					}
					allActionLists.push({ board: name, data: actionLists });
				} catch (e) {
					/* handle error */
					console.error(e);
					continue;
				}
			}

			console.log("=============================");
			console.log("allTodoLists", allTodoLists);
			console.log("=============================");
			console.log("allActionLists", allActionLists);
			console.log("=============================");
			return [allActionLists, allTodoLists];
		})
		.then(([actionList, todoList]) => {
			const data = [
				...actionList.map(({ data }) => data).sort(sortByItemName),
				...todoList.map(({ data }) => data).sort(sortByItemName),
			];
			console.log("writing data to output.csv");
			writeJsonToCsv(data, "./output.csv");
			console.log("completed!");
			console.log("=============================");
		})
		.catch(console.error);

	readline.close();
});
